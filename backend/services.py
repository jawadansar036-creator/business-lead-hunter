
import os
import re
import asyncio
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()

LANGSEARCH_API_KEY = os.getenv("LANGSEARCH_API_KEY")
LANGSEARCH_URL = "https://api.langsearch.com/v1/web-search"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

BLOCKED_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com",
    "tiktok.com", "youtube.com", "twitter.com",
    "x.com", "wikipedia.org", "google.com",
    "yelp.com", "tripadvisor.com",
}

DIRECTORY_DOMAINS = {
    "yelp.com", "tripadvisor.com", "yellowpages.com",
    "foursquare.com", "mapquest.com", "facebook.com",
    "instagram.com", "linkedin.com", "justdial.com",
    "businesslist.pk", "lookup.pk",
}

# Broad selectors: these cover many kinds of businesses.
# Niche relevance is assessed after retrieving the map data.
BUSINESS_SELECTORS = [
    'nwr["name"]["shop"]',
    'nwr["name"]["office"]',
    'nwr["name"]["craft"]',
    'nwr["name"]["amenity"]',
    'nwr["name"]["healthcare"]',
    'nwr["name"]["tourism"]',
    'nwr["name"]["leisure"]',
    'nwr["name"]["sport"]',
    'nwr["name"]["club"]',
    'nwr["name"]["industrial"]',
    'nwr["name"]["building"]',
    'nwr["name"]["company"]',
    'nwr["name"]["brand"]',
]


def normalize_text(value):
    """Normalize text while preserving Unicode, including Urdu."""
    value = str(value or "").lower()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def tokens(value):
    ignored = {
        "the", "and", "for", "in", "of", "near",
        "with", "a", "an", "company", "business",
    }
    return {
        word for word in normalize_text(value).split()
        if word not in ignored and len(word) > 1
    }


def domain_of(url):
    try:
        host = urlparse(url).netloc.lower().split(":")[0]
        return host.removeprefix("www.")
    except Exception:
        return ""


def is_blocked_domain(url):
    domain = domain_of(url)
    return any(
        domain == blocked or domain.endswith("." + blocked)
        for blocked in BLOCKED_DOMAINS
    )


def is_directory_domain(url):
    domain = domain_of(url)
    return any(
        domain == blocked or domain.endswith("." + blocked)
        for blocked in DIRECTORY_DOMAINS
    )


def niche_matches_business(business, niche):
    """Check whether OSM business tags or name relate to the requested niche."""
    niche_words = tokens(niche)
    if not niche_words:
        return True

    searchable = " ".join([
        business.get("business_name", ""),
        business.get("name", ""),
        business.get("category", ""),
        business.get("shop", ""),
        business.get("office", ""),
        business.get("amenity", ""),
        business.get("craft", ""),
        business.get("healthcare", ""),
        business.get("tourism", ""),
        business.get("leisure", ""),
        business.get("sport", ""),
        business.get("club", ""),
        business.get("industrial", ""),
        business.get("description", ""),
    ])

    business_words = tokens(searchable)

    # Exact phrase match is strongest.
    if normalize_text(niche) in normalize_text(searchable):
        return True

    # Match niche terms against business name and category tags.
    return bool(niche_words.intersection(business_words))


def extract_langsearch_results(payload):
    """Handle common LangSearch response structures."""
    if not isinstance(payload, dict):
        return []

    data = payload.get("data", payload)

    if isinstance(data, list):
        return data

    if not isinstance(data, dict):
        return []

    for key in ("webPages", "web_pages", "results", "items"):
        section = data.get(key)

        if isinstance(section, list):
            return section

        if isinstance(section, dict):
            for nested_key in ("value", "results", "items"):
                nested = section.get(nested_key)
                if isinstance(nested, list):
                    return nested

    return []


async def find_location_coordinates(location):
    params = {
        "q": location,
        "format": "json",
        "limit": 1,
    }

    headers = {"User-Agent": "LeadPilot/1.0"}

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            NOMINATIM_URL,
            params=params,
            headers=headers,
        )
        response.raise_for_status()
        results = response.json()

    if not results:
        raise ValueError(
            f"Could not find the location: {location}"
        )

    return float(results[0]["lat"]), float(results[0]["lon"])


def build_overpass_query(latitude, longitude, radius):
    selectors = "\n".join(
        f'{selector}(around:{radius},{latitude},{longitude});'
        for selector in BUSINESS_SELECTORS
    )

    return f"""
    [out:json][timeout:90];
    (
        {selectors}
    );
    out center tags;
    """


async def fetch_overpass_data(query):
    headers = {
        "User-Agent": "LeadPilot/1.0",
        "Content-Type": "application/x-www-form-urlencoded",
    }

    async with httpx.AsyncClient(timeout=110) as client:
        for endpoint in OVERPASS_URLS:
            try:
                response = await client.post(
                    endpoint,
                    data={"data": query},
                    headers=headers,
                )

                if response.status_code in (429, 502, 503, 504):
                    await asyncio.sleep(2)
                    continue

                response.raise_for_status()
                return response.json().get("elements", [])

            except (httpx.HTTPError, ValueError):
                continue

    return []


def osm_element_to_business(element):
    tags = element.get("tags", {})
    name = tags.get("name")

    if not name:
        return None

    if element.get("type") == "node":
        latitude = element.get("lat")
        longitude = element.get("lon")
    else:
        center = element.get("center", {})
        latitude = center.get("lat")
        longitude = center.get("lon")

    category_fields = [
        "shop", "office", "amenity", "healthcare",
        "craft", "tourism", "leisure", "sport",
        "club", "industrial",
    ]

    category = next(
        (tags[field] for field in category_fields if tags.get(field)),
        "",
    )

    address_parts = [
        tags.get("addr:housenumber"),
        tags.get("addr:street"),
        tags.get("addr:suburb"),
        tags.get("addr:city"),
        tags.get("addr:state"),
        tags.get("addr:country"),
    ]

    address = ", ".join(part for part in address_parts if part)

    return {
        "business_name": name,
        "name": name,
        "location": address,
        "latitude": latitude,
        "longitude": longitude,
        "category": category,
        "phone": tags.get("phone") or tags.get("contact:phone", ""),
        "email": tags.get("email") or tags.get("contact:email", ""),
        "website": (
            tags.get("website")
            or tags.get("contact:website")
            or ""
        ),
        "source": "OpenStreetMap",
        "osm_id": f'{element.get("type")}/{element.get("id")}',
        "osm_tags": tags,
    }


async def find_businesses(
    latitude,
    longitude,
    business_type,
    radius=10000,
    max_leads=100,
):
    query = build_overpass_query(latitude, longitude, radius)
    elements = await fetch_overpass_data(query)

    businesses = []
    seen = set()

    for element in elements:
        business = osm_element_to_business(element)

        if not business:
            continue

        if not niche_matches_business(business, business_type):
            continue

        unique_id = business.get("osm_id")

        if unique_id in seen:
            continue

        seen.add(unique_id)
        businesses.append(business)

        if len(businesses) >= max_leads:
            break

    return businesses


async def langsearch(query, count=10):
    if not LANGSEARCH_API_KEY:
        return []

    headers = {
        "Authorization": f"Bearer {LANGSEARCH_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "query": query,
        "freshness": "noLimit",
        "summary": True,
        "count": count,
    }

    try:
        async with httpx.AsyncClient(timeout=35) as client:
            response = await client.post(
                LANGSEARCH_URL,
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            return extract_langsearch_results(response.json())

    except (httpx.HTTPError, ValueError):
        return []


def result_value(item, *keys):
    for key in keys:
        value = item.get(key)
        if value:
            return str(value)
    return ""


def clean_business_title(title):
    """Remove common website title suffixes."""
    title = re.split(
        r"\s+[|–—-]\s+",
        title,
        maxsplit=1,
    )[0]

    return title.strip(" -|")


def looks_like_article(title, url):
    text = normalize_text(title)
    domain = domain_of(url)

    article_terms = {
        "top 10", "best restaurants", "best businesses",
        "list of", "directory", "near me",
        "things to do", "review", "reviews",
        "guide to", "how to", "news",
    }

    if any(term in text for term in article_terms):
        return True

    if is_directory_domain(url):
        return True

    return False


async def discover_web_businesses(location, business_type, max_leads):
    """Discover additional possible businesses through web search."""
    queries = [
        f"{business_type} businesses in {location}",
        f"{business_type} companies and shops in {location}",
    ]

    discovered = []
    seen_urls = set()

    for query in queries:
        results = await langsearch(query, count=10)

        for item in results:
            if not isinstance(item, dict):
                continue

            title = result_value(item, "name", "title")
            url = result_value(item, "url", "link")
            snippet = result_value(item, "snippet", "description", "summary")

            if not title or not url:
                continue

            if not url.startswith(("http://", "https://")):
                continue

            if is_blocked_domain(url) or is_directory_domain(url):
                continue

            if looks_like_article(title, url):
                continue

            if url in seen_urls:
                continue

            seen_urls.add(url)

            name = clean_business_title(title)

            # Avoid treating generic search-result headings as businesses.
            if len(tokens(name)) < 1:
                continue

            discovered.append({
                "business_name": name,
                "name": name,
                "location": location,
                "phone": "",
                "email": "",
                "website": "",
                "source": "Web discovery",
                "web_discovery_url": url,
                "web_discovery_snippet": snippet,
                "category": business_type,
                "osm_id": "",
            })

            if len(discovered) >= max_leads:
                return discovered

    return discovered


def merge_businesses(osm_businesses, web_businesses):
    """Merge likely duplicates while retaining source information."""
    merged = []
    name_index = {}

    for business in osm_businesses + web_businesses:
        name = normalize_text(business.get("business_name", ""))

        if not name:
            continue

        key = name

        if key not in name_index:
            copy = dict(business)
            copy["sources"] = [business.get("source", "")]
            name_index[key] = copy
            merged.append(copy)
        else:
            existing = name_index[key]

            source = business.get("source", "")
            if source and source not in existing["sources"]:
                existing["sources"].append(source)

            # Fill missing fields only with data from the same business record.
            for field in ("phone", "email", "location", "website"):
                if not existing.get(field) and business.get(field):
                    existing[field] = business[field]

    return merged


async def search_business_website(business):
    name = business.get("business_name", "")
    location = business.get("location") or business.get("search_location", "")
    niche = business.get("business_type", "")

    queries = [
        f'"{name}" "{location}" official website',
        f'"{name}" "{location}" {niche}',
    ]

    results = []
    seen = set()

    for query in queries:
        items = await langsearch(query, count=5)

        for item in items:
            if not isinstance(item, dict):
                continue

            title = result_value(item, "name", "title")
            url = result_value(item, "url", "link")
            snippet = result_value(item, "snippet", "description", "summary")

            if not url or not url.startswith(("http://", "https://")):
                continue

            if is_blocked_domain(url) or is_directory_domain(url):
                continue

            if url in seen:
                continue

            seen.add(url)

            # Only retain a candidate if the business name appears in
            # the page title or domain. A mention in article text alone
            # is not enough to establish a plausible official site.
            name_words = tokens(name)
            title_words = tokens(title)
            domain_words = tokens(domain_of(url).replace(".", " "))

            title_match = (
                bool(name_words)
                and (
                    name_words.issubset(title_words)
                    or normalize_text(name) in normalize_text(title)
                )
            )

            domain_match = (
                bool(name_words)
                and name_words.issubset(domain_words)
            )

            if not (title_match or domain_match):
                continue

            results.append({
                "title": title,
                "url": url,
                "snippet": snippet,
                "match_status": "name_match_unverified",
            })

    return results


def set_contact_status(business):
    phone = business.get("phone", "")
    email = business.get("email", "")

    if phone and email:
        status = "phone_and_email_available"
    elif phone:
        status = "phone_available"
    elif email:
        status = "email_available"
    else:
        status = "missing"

    business["contact_status"] = status
    business["has_contact_details"] = bool(phone or email)

    if phone or email:
        business["contact_source"] = (
            business.get("contact_source") or "OpenStreetMap"
        )
    else:
        business["contact_source"] = ""

    return business


async def enrich_business(business):
    result = dict(business)

    result["candidate_websites"] = []
    result["research_sources"] = []
    result["website_checked"] = True

    # A website supplied by OSM is retained, but is not ownership-verified.
    osm_website = result.get("website", "")

    try:
        candidates = await search_business_website(result)
        result["candidate_websites"] = candidates
        result["research_sources"] = [
            {
                "title": item["title"],
                "url": item["url"],
            }
            for item in candidates
        ]
        result["research_status"] = "completed"

    except Exception:
        result["research_status"] = "failed"

    if osm_website:
        result["website_status"] = "found"
        result["website_verification_status"] = "unverified"

    elif result["candidate_websites"]:
        result["website_status"] = "candidate_found"
        result["website_verification_status"] = "unverified"

    elif result["research_status"] == "failed":
        result["website_status"] = "research_failed"
        result["website_verification_status"] = "not_applicable"

    else:
        result["website_status"] = "not_found"
        result["website_verification_status"] = "not_applicable"

    result["is_potential_website_prospect"] = (
        not bool(osm_website)
        and not bool(result["candidate_websites"])
        and result["website_status"] == "not_found"
    )

    set_contact_status(result)

    return result


async def generate_business_leads(
    location,
    business_type,
    radius=10000,
    max_leads=100,
    enrich=True,
):
    latitude, longitude = await find_location_coordinates(location)

    # Run both discovery sources.
    osm_businesses, web_businesses = await asyncio.gather(
        find_businesses(
            latitude,
            longitude,
            business_type,
            radius,
            max_leads,
        ),
        discover_web_businesses(
            location,
            business_type,
            max_leads,
        ),
    )

    # Keep web-only discovery records clearly identified.
    for business in osm_businesses + web_businesses:
        business["search_location"] = location
        business["business_type"] = business_type

        if not business.get("location"):
            business["location"] = location

    businesses = merge_businesses(
        osm_businesses,
        web_businesses,
    )

    businesses = businesses[:max_leads]

    if enrich:
        semaphore = asyncio.Semaphore(5)

        async def limited_enrich(business):
            async with semaphore:
                return await enrich_business(business)

        businesses = await asyncio.gather(
            *[limited_enrich(business) for business in businesses]
        )

    else:
        for business in businesses:
            business["website_status"] = (
                "found" if business.get("website") else "not_checked"
            )
            business["candidate_websites"] = []
            business["research_sources"] = []
            business["is_potential_website_prospect"] = False
            set_contact_status(business)

    # Prioritize prospects with contact details, then prospects without them.
    def sort_key(business):
        if business.get("is_potential_website_prospect"):
            return 0 if business.get("has_contact_details") else 1

        if business.get("website_status") == "candidate_found":
            return 2

        if business.get("website_status") == "found":
            return 3

        return 4

    businesses.sort(key=sort_key)

    prospects = [
        business for business in businesses
        if business.get("is_potential_website_prospect")
    ]

    website_candidates = [
        business for business in businesses
        if business.get("website_status") == "candidate_found"
    ]

    website_listed = [
        business for business in businesses
        if business.get("website_status") == "found"
    ]

    prospects_with_contacts = [
        business for business in prospects
        if business.get("has_contact_details")
    ]

    prospects_without_contacts = [
        business for business in prospects
        if not business.get("has_contact_details")
    ]

    return {
        "success": True,
        "search_location": location,
        "resolved_location": location,
        "coordinates": {
            "latitude": latitude,
            "longitude": longitude,
        },
        "business_type": business_type,
        "radius_meters": radius,
        "total_leads": len(businesses),
        "osm_leads_found": len(osm_businesses),
        "web_discovery_leads_found": len(web_businesses),
        "researched_leads": sum(
            1 for business in businesses
            if business.get("research_status") == "completed"
        ),
        "website_candidates": len(website_candidates),
        "businesses_with_website_listed": len(website_listed),
        "potential_website_prospects": len(prospects),
        "prospects_with_contact_details": len(prospects_with_contacts),
        "prospects_missing_contact_details": len(prospects_without_contacts),
        "potential_website_prospect_list": prospects,
        "businesses": businesses,
    }


async def test_langsearch():
    results = await langsearch(
        "pharmacies in Gulberg Lahore Pakistan",
        count=5,
    )

    print("LangSearch results:")
    for item in results:
        print(
            result_value(item, "name", "title"),
            result_value(item, "url", "link"),
        )
