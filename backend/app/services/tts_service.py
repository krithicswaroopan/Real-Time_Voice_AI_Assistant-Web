"""Text-to-Speech service using Coqui TTS."""

import logging
import asyncio
import tempfile
import os
from typing import Optional
import subprocess
import io
from TTS.api import TTS
from app.config import settings
from app.models.tts import TTSRequest, TTSResponse

logger = logging.getLogger(__name__)


class TTSService:
    """Text-to-Speech service using Coqui TTS."""
    
    def __init__(self):
        """Initialize the TTS service."""
        self.model_name = settings.tts_model
        self.tts = None
        self._initialize_tts()
    
    def _initialize_tts(self):
        """Initialize TTS model."""
        try:
            self.tts = TTS(model_name=self.model_name)
            logger.info(f"TTS initialized with model: {self.model_name}")
        except Exception as e:
            logger.error(f"Failed to initialize TTS: {e}")
            self.tts = None
    
    async def synthesize_speech(self, request: TTSRequest) -> TTSResponse:
        """Synthesize speech from text."""
        try:
            if not self.tts:
                return TTSResponse(
                    success=False,
                    error="TTS not available"
                )
            
            # Create temp file for output
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
            
            try:
                # Generate speech
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: self.tts.tts_to_file(
                        text=request.text,
                        file_path=temp_path
                    )
                )
                
                # Read audio data
                with open(temp_path, 'rb') as f:
                    audio_data = f.read()
                
                return TTSResponse(
                    success=True,
                    audio_data=audio_data,
                    duration_ms=len(audio_data) // 32,  # Rough estimate
                    word_count=len(request.text.split()),
                    voice_used=request.voice or "default"
                )
                
            finally:
                # Clean up temp file
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                    
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            return TTSResponse(
                success=False,
                error=str(e)
            )
    


# Global TTS service instance
tts_service = TTSService() 