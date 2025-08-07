"""Chat and conversation data models."""

from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ConversationMessage(BaseModel):
    """Model for a single conversation message."""
    
    id: Optional[str] = Field(None, description="Unique message ID")
    role: str = Field(..., description="Message role: 'user' or 'assistant'")
    content: str = Field(..., description="Message content")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Message timestamp")
    audio_url: Optional[str] = Field(None, description="URL to audio file if applicable")
    rating: Optional[int] = Field(None, ge=1, le=5, description="User rating (1-5 stars)")


class ChatRequest(BaseModel):
    """Request model for chat interactions."""
    
    message: str = Field(..., description="User message text")
    conversation_id: Optional[str] = Field(None, description="Conversation ID for context")
    model: Optional[str] = Field(None, description="LLM model to use")
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0, description="Model temperature")
    max_tokens: Optional[int] = Field(default=1000, description="Maximum tokens in response")
    system_prompt: Optional[str] = Field(None, description="System prompt for context")


class ChatResponse(BaseModel):
    """Response model for chat interactions."""
    
    model_config = {"protected_namespaces": ()}
    
    success: bool = Field(..., description="Whether the chat request was successful")
    message: str = Field(..., description="Assistant response text")
    conversation_id: str = Field(..., description="Conversation ID")
    message_id: str = Field(..., description="Message ID")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Response timestamp")
    model_used: str = Field(..., description="LLM model used for response")
    tokens_used: Optional[int] = Field(None, description="Number of tokens used")
    audio_url: Optional[str] = Field(None, description="URL to TTS audio file")
    error: Optional[str] = Field(None, description="Error message if request failed")


class ConversationHistory(BaseModel):
    """Model for conversation history."""
    
    conversation_id: str = Field(..., description="Unique conversation ID")
    user_id: Optional[str] = Field(None, description="User ID")
    messages: List[ConversationMessage] = Field(default_factory=list, description="List of messages")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Conversation creation time")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update time")
    title: Optional[str] = Field(None, description="Conversation title")
    is_active: bool = Field(default=True, description="Whether conversation is active") 