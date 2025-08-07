"""Main FastAPI application for the AI Assistant."""

import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
import time

from app.config import settings
from app.routers import (
    asr_router,
    chat_router,
    tts_router,
    streaming_router,
    health_router
)
from app.services.asr_service import asr_service
from app.services.llm_service import llm_service

# Configure structured logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("logs/app.log", mode="a")
    ]
)

logger = logging.getLogger(__name__)

# Create FastAPI application
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description="Real-time Conversational AI Assistant API",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.debug else settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add trusted host middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"] if settings.debug else [
        "localhost",
        "127.0.0.1",
        *settings.allowed_hosts
    ]
)


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add processing time header to responses."""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests."""
    start_time = time.time()
    
    # Log request
    logger.info(f"Request: {request.method} {request.url}")
    
    response = await call_next(request)
    
    # Log response
    process_time = time.time() - start_time
    logger.info(f"Response: {response.status_code} - {process_time:.3f}s")
    
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler."""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error": str(exc) if settings.debug else "An unexpected error occurred"
        }
    )


@app.on_event("startup")
async def startup_event():
    """Application startup event."""
    logger.info("Starting AI Assistant API...")
    logger.info(f"API Title: {settings.api_title}")
    logger.info(f"API Version: {settings.api_version}")
    logger.info(f"Debug Mode: {settings.debug}")
    logger.info(f"Host: {settings.host}")
    logger.info(f"Port: {settings.port}")
    
    # Log service configurations
    logger.info(f"ASR Model: {settings.whisper_model}")
    logger.info(f"LLM Model: {settings.default_llm_model}")
    logger.info(f"TTS Model: {settings.tts_model}")
    logger.info(f"Janus URL: {settings.janus_url}")
    
    logger.info("AI Assistant API started successfully!")


@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown event."""
    logger.info("Shutting down AI Assistant API...")
    
    # Close service connections
    try:
        await asr_service.close()
        await llm_service.close()
        logger.info("Service connections closed successfully")
    except Exception as e:
        logger.error(f"Error closing service connections: {str(e)}")
    
    logger.info("AI Assistant API shutdown complete!")


# Include routers
app.include_router(health_router, prefix="/api/v1")
app.include_router(asr_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(tts_router, prefix="/api/v1")
app.include_router(streaming_router, prefix="/api/v1")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "AI Assistant API",
        "version": settings.api_version,
        "docs": "/docs",
        "health": "/api/v1/health"
    }


@app.get("/api/v1")
async def api_root():
    """API root endpoint."""
    return {
        "message": "AI Assistant API v1",
        "endpoints": {
            "health": "/api/v1/health",
            "asr": "/api/v1/asr",
            "chat": "/api/v1/chat",
            "tts": "/api/v1/tts",
            "streaming": "/api/v1/streaming"
        },
        "docs": "/docs"
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower()
    ) 