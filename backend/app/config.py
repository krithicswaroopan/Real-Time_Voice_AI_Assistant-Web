"""Configuration settings for the AI Assistant application."""

import os
from typing import Optional, List
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # API Configuration
    api_title: str = "AI Assistant API"
    api_version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")
    
    # Server Configuration
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=8000, env="PORT")
    allowed_hosts: List[str] = Field(default=["localhost", "127.0.0.1"])

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def parse_allowed_hosts(cls, v):
        if isinstance(v, str):
            return [host.strip() for host in v.split(",")]
        return v
    
    # CORS Configuration
    cors_origins: List[str] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:8080",
            "ws://localhost:8000",
            "wss://localhost:8000"
        ]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v
    
    # OpenAI API Configuration (for Whisper)
    openai_api_key: str = Field(..., env="OPENAI_API_KEY")
    
    # OpenRouter API Configuration (for LLM)
    openrouter_api_key: str = Field(..., env="OPENROUTER_API_KEY")
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        env="OPENROUTER_BASE_URL"
    )
    
    # LLM Model Configuration
    default_llm_model: str = Field(
        default="meta-llama/llama-3.1-8b-instruct",
        env="DEFAULT_LLM_MODEL"
    )
    
    # Whisper Configuration
    whisper_model: str = Field(default="whisper-1", env="WHISPER_MODEL")
    
    # Coqui TTS Configuration
    tts_model: str = Field(
        default="tts_models/en/ljspeech/tacotron2-DDC",
        env="TTS_MODEL"
    )
    tts_default_voice: str = Field(
        default="ljspeech",
        env="TTS_DEFAULT_VOICE"
    )
    
    # Audio Processing Configuration
    sample_rate: int = Field(default=16000, env="SAMPLE_RATE")
    chunk_duration_ms: int = Field(default=100, env="CHUNK_DURATION_MS")  # Increased from 30ms to 100ms for stability
    vad_mode: int = Field(default=1, env="VAD_MODE")  # Reduced from 3 to 1 for less aggressive detection
    vad_min_speech_duration_ms: int = Field(default=200, env="VAD_MIN_SPEECH_DURATION_MS")  # Minimum speech duration
    vad_speech_threshold: float = Field(default=0.5, env="VAD_SPEECH_THRESHOLD")  # Speech confidence threshold
    
    # WebRTC Configuration
    janus_url: str = Field(
        default="ws://localhost:8188",
        env="JANUS_URL"
    )
    janus_admin_secret: Optional[str] = Field(
        default=None, env="JANUS_ADMIN_SECRET"
    )
    
    # Database Configuration
    database_url: str = Field(
        default="sqlite:///./ai_assistant.db",
        env="DATABASE_URL"
    )
    
    # Redis Configuration
    redis_url: str = Field(
        default="redis://localhost:6379",
        env="REDIS_URL"
    )
    
    # Security Configuration
    secret_key: str = Field(..., env="SECRET_KEY")
    algorithm: str = Field(default="HS256", env="ALGORITHM")

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v):
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long")
        if v in ["ai_voice_webapp", "your_secret_key_here"]:
            raise ValueError("SECRET_KEY must be changed from default value")
        return v
    access_token_expire_minutes: int = Field(
        default=30, env="ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    
    # Rate Limiting
    rate_limit_per_minute: int = Field(
        default=60, env="RATE_LIMIT_PER_MINUTE"
    )
    
    # Logging Configuration
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings() 