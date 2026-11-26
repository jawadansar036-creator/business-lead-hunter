
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services import generate_business_leads

app = FastAPI(
    title="LeadPilot API",
    description="Local business lead discovery and enrichment API",
    version="1.0.0"
)

# Frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LeadSearchRequest(BaseModel):
    business_type: str = Field(min_length=2, max_length=100)
    target_location: str = Field(min_length=2, max_length=200)
    maximum_leads: int = Field(default=100, ge=1, le=500)


@app.get("/")
async def home():
    return {"message": "LeadPilot API is running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/api/search")
async def search_leads(request: LeadSearchRequest):

    try:
        result = await generate_business_leads(
            location=request.target_location,
            business_type=request.business_type,
            radius=10000,
            max_leads=request.maximum_leads,
            enrich=True
        )

        return result

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Lead search failed: {str(error)}"
        )
