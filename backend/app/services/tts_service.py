"""Text-to-Speech service using Coqui TTS."""

import logging
import asyncio
import tempfile
import os
import time
from typing import Optional
import subprocess
import io
from concurrent.futures import ThreadPoolExecutor
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
        self.executor = ThreadPoolExecutor(max_workers=2)  # Limit concurrent TTS
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
        """Synthesize speech from text with optimizations."""
        start_time = time.time()
        
        try:
            if not self.tts:
                return TTSResponse(
                    success=False,
                    error="TTS not available"
                )
            
            # Truncate very long text to prevent extremely long processing times
            text = request.text[:200] if len(request.text) > 200 else request.text
            if len(request.text) > 200:
                logger.warning(f"Truncated TTS text from {len(request.text)} to 200 characters")
                text += "..." # Add ellipsis to indicate truncation
            
            # Create temp file for output
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
            
            try:
                # Generate speech with dedicated executor
                logger.info(f"Starting TTS synthesis for {len(text)} characters")
                
                # Split long text into sentences for faster processing
                sentences = text.split('. ')
                if len(sentences) > 2:
                    # Only use first 2 sentences to keep it short
                    text = '. '.join(sentences[:2]) + '.'
                    logger.info(f"Reduced to first 2 sentences: {len(text)} characters")
                
                await asyncio.get_event_loop().run_in_executor(
                    self.executor,
                    lambda: self.tts.tts_to_file(
                        text=text,
                        file_path=temp_path
                    )
                )
                synthesis_time = time.time() - start_time
                logger.info(f"TTS synthesis completed in {synthesis_time:.2f} seconds")
                
                # Read audio data
                with open(temp_path, 'rb') as f:
                    audio_data = f.read()
                
                total_time = time.time() - start_time
                logger.info(f"Total TTS processing time: {total_time:.2f} seconds")
                
                return TTSResponse(
                    success=True,
                    audio_data=audio_data,
                    duration_ms=int(len(audio_data) // 32),  # Rough estimate
                    word_count=len(text.split()),
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