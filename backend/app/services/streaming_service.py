"""Streaming service for WebRTC and WebSocket handling."""

import logging
import json
import asyncio
import uuid
import time
from typing import Dict, Optional, Callable, Any
import websockets
from app.config import settings

logger = logging.getLogger(__name__)


class StreamingService:
    """Streaming service for WebRTC and WebSocket handling."""
    
    def __init__(self):
        """Initialize the streaming service."""
        self.janus_url = settings.janus_url
        self.admin_secret = settings.janus_admin_secret
        self.active_connections: Dict[str, Dict[str, Any]] = {}
        self.websocket_connections: Dict[str, websockets.WebSocketServerProtocol] = {}
        self._silence_check_task = None
        self._start_silence_checker()
    
    async def create_janus_session(self) -> Optional[str]:
        """
        Create a new Janus WebRTC session.
        
        Returns:
            Session ID if successful, None otherwise
        """
        try:
            async with websockets.connect(self.janus_url) as websocket:
                # Create session
                create_session = {
                    "janus": "create",
                    "transaction": str(uuid.uuid4())
                }
                
                await websocket.send(json.dumps(create_session))
                response = await websocket.recv()
                data = json.loads(response)
                
                if data.get("janus") == "success":
                    session_id = data["data"]["id"]
                    logger.info(f"Created Janus session: {session_id}")
                    return str(session_id)
                else:
                    logger.error(f"Failed to create Janus session: {data}")
                    return None
                    
        except Exception as e:
            logger.error(f"Janus session creation failed: {str(e)}")
            return None
    
    async def create_audio_room(
        self, 
        session_id: str,
        room_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Create an audio room in Janus.
        
        Args:
            session_id: Janus session ID
            room_id: Optional room ID (will generate if not provided)
            
        Returns:
            Room ID if successful, None otherwise
        """
        try:
            room_id = room_id or str(uuid.uuid4())
            
            async with websockets.connect(self.janus_url) as websocket:
                # Attach audio bridge plugin
                attach_plugin = {
                    "janus": "attach",
                    "plugin": "janus.plugin.audiobridge",
                    "transaction": str(uuid.uuid4())
                }
                
                await websocket.send(json.dumps(attach_plugin))
                response = await websocket.recv()
                data = json.loads(response)
                
                if data.get("janus") == "success":
                    handle_id = data["data"]["id"]
                    
                    # Create room
                    create_room = {
                        "janus": "message",
                        "handle_id": handle_id,
                        "transaction": str(uuid.uuid4()),
                        "body": {
                            "request": "create",
                            "room": int(room_id),
                            "description": f"Audio room {room_id}",
                            "secret": self.admin_secret,
                            "pin": None,
                            "is_private": False,
                            "allow_rtp_participants": True,
                            "audiolevel_ext": True,
                            "audiolevel_event": True,
                            "audio_active_packets": 100,
                            "audio_level_average": 25,
                            "default_prebuffering": 200,
                            "default_gain": 1.0,
                            "default_volume": 90
                        }
                    }
                    
                    await websocket.send(json.dumps(create_room))
                    response = await websocket.recv()
                    data = json.loads(response)
                    
                    if data.get("janus") == "success":
                        logger.info(f"Created audio room: {room_id}")
                        return room_id
                    else:
                        logger.error(f"Failed to create audio room: {data}")
                        return None
                else:
                    logger.error(f"Failed to attach audio bridge plugin: {data}")
                    return None
                    
        except Exception as e:
            logger.error(f"Audio room creation failed: {str(e)}")
            return None
    
    async def handle_websocket_connection(
        self,
        websocket,  # Accept FastAPI's WebSocket type
        path: str
    ):
        """
        Handle WebSocket connection for audio streaming with persistent connection management.

        Args:
            websocket: FastAPI WebSocket connection
            path: Connection path
        """
        connection_id = str(uuid.uuid4())
        self.websocket_connections[connection_id] = websocket

        # Initialize connection state
        self.active_connections[connection_id] = {
            "audio_buffer": [],
            "session_id": None,
            "room_id": None,
            "last_activity": time.time(),
            "is_active": True,
            "last_speech_time": None,
            "speech_timeout": 1.5,  # seconds of silence before triggering transcription
            "min_audio_duration": 0.15,  # minimum audio duration in seconds for API
            "max_buffer_duration": 10.0  # maximum buffer duration in seconds
        }

        try:
            logger.info(f"WebSocket connection established: {connection_id} from {websocket.client.host}:{websocket.client.port}")
            logger.info(f"Total active connections: {len(self.websocket_connections)}")
            
            # Log connection details for debugging
            logger.debug(f"Active connection IDs: {list(self.websocket_connections.keys())}")
            
            # Send connection confirmation
            await self.send_websocket_message(connection_id, {
                "type": "connection_established",
                "connection_id": connection_id,
                "status": "ready"
            })

            # Keep connection alive with proper error handling
            while True:
                try:
                    # Check connection state
                    if websocket.client_state.name == "DISCONNECTED":
                        logger.info(f"WebSocket client disconnected: {connection_id}")
                        break
                    
                    # Set a reasonable timeout for receiving messages
                    try:
                        message = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                        
                        # Update last activity time
                        self.active_connections[connection_id]["last_activity"] = time.time()
                        
                        # Process the message
                        try:
                            data = json.loads(message)
                            await self.process_websocket_message(connection_id, data)
                        except json.JSONDecodeError:
                            logger.warning(f"Invalid JSON received from {connection_id}")
                            await self.send_websocket_message(connection_id, {
                                "type": "error",
                                "message": "Invalid JSON format"
                            })
                        except Exception as e:
                            logger.error(f"Error processing WebSocket message: {str(e)}")
                            await self.send_websocket_message(connection_id, {
                                "type": "error",
                                "message": "Message processing failed"
                            })
                            
                    except asyncio.TimeoutError:
                        # No message received within timeout - this is normal
                        # Just continue the loop to keep connection alive
                        continue
                    
                except Exception as e:
                    error_code = getattr(e, 'code', 'unknown')
                    if error_code == 1012:
                        logger.info(f"WebSocket service restart detected: {connection_id}")
                    elif error_code == 1001:
                        logger.info(f"WebSocket client going away: {connection_id}")
                    else:
                        logger.error(f"WebSocket receive error ({error_code}): {str(e)}")
                    break

        except Exception as e:
            logger.error(f"WebSocket connection error: {str(e)}")
        finally:
            # Clean up connection
            logger.info(f"Cleaning up WebSocket connection: {connection_id}")
            
            # Force cleanup of WebSocket connection
            try:
                if connection_id in self.websocket_connections:
                    ws = self.websocket_connections[connection_id]
                    if hasattr(ws, 'client_state') and ws.client_state.name != "DISCONNECTED":
                        try:
                            await ws.close(code=1000, reason="Connection cleanup")
                        except Exception:
                            pass  # Connection may already be closed
                    del self.websocket_connections[connection_id]
            except Exception as cleanup_error:
                logger.error(f"Error during WebSocket cleanup: {cleanup_error}")
            
            # Clean up connection state
            if connection_id in self.active_connections:
                del self.active_connections[connection_id]
            
            logger.info(f"Remaining active connections: {len(self.websocket_connections)}")
            logger.debug(f"Remaining connection IDs: {list(self.websocket_connections.keys())}")
    
    async def process_websocket_message(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """
        Process incoming WebSocket message.
        
        Args:
            connection_id: Connection identifier
            data: Message data
        """
        message_type = data.get("type")
        
        if message_type == "audio_chunk":
            await self.handle_audio_chunk(connection_id, data)
        elif message_type == "transcription_request":
            await self.handle_transcription_request(connection_id, data)
        elif message_type == "chat_request":
            await self.handle_chat_request(connection_id, data)
        elif message_type == "tts_request":
            await self.handle_tts_request(connection_id, data)
        elif message_type == "rating":
            await self.handle_rating(connection_id, data)
        else:
            logger.warning(f"Unknown message type: {message_type}")
    
    async def handle_audio_chunk(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """Handle incoming audio chunk."""
        try:
            # Validate connection exists and is active
            if connection_id not in self.active_connections:
                logger.warning(f"Received audio chunk for inactive connection: {connection_id}")
                return
            
            # Check for connection ID mismatch (if client sends it)
            client_connection_id = data.get("connection_id")
            if client_connection_id and client_connection_id != connection_id:
                logger.warning(f"Connection ID mismatch: server={connection_id}, client={client_connection_id}")
                return
            
            audio_data = data.get("audio_data")
            audio_format = data.get("format", "webm")  # Default to WebM from MediaRecorder
            
            if not audio_data:
                return
            
            # Convert audio data from list to bytes
            if isinstance(audio_data, list):
                audio_bytes = bytes(audio_data)
            else:
                audio_bytes = audio_data
            
            from app.services.audio_service import audio_service
            
            # Handle different audio formats
            if audio_format.lower() == "webm":
                # Convert WebM to PCM
                pcm_data, conversion_success = audio_service.convert_webm_to_pcm(audio_bytes)
                if not conversion_success or not pcm_data:
                    logger.warning(f"Failed to convert WebM audio from {connection_id} - FFmpeg not available. Install FFmpeg for WebM support.")
                    # Skip this chunk but don't crash
                    return
                processed_audio, has_speech = audio_service.process_audio_chunk(pcm_data)
                logger.debug(f"Converted WebM audio chunk: {len(audio_bytes)} → {len(pcm_data)} bytes PCM from {connection_id}, has_speech: {has_speech}")
            else:
                # Handle PCM format
                processed_audio, has_speech = audio_service.process_audio_chunk(audio_bytes)
                logger.debug(f"Received {audio_format.upper()} audio chunk: {len(audio_bytes)} bytes from {connection_id}, has_speech: {has_speech}")
            
            # Debug logging for VAD results (reduced verbosity)
            if has_speech:
                logger.debug(f"VAD detected speech in audio chunk from {connection_id}")
            else:
                logger.debug(f"VAD detected silence in audio chunk from {connection_id}")
            
            if has_speech:
                # Store audio for transcription
                if connection_id not in self.active_connections:
                    self.active_connections[connection_id] = {
                        "audio_buffer": [],
                        "session_id": None,
                        "room_id": None,
                        "last_speech_time": None,
                        "speech_timeout": 1.5,
                        "min_audio_duration": 0.15,
                        "max_buffer_duration": 10.0
                    }
                
                # Add audio to buffer and update speech timing
                self.active_connections[connection_id]["audio_buffer"].append(processed_audio)
                self.active_connections[connection_id]["last_speech_time"] = time.time()
                
                # Check if we should trigger transcription
                await self._check_transcription_trigger(connection_id)
                
                # Send processed audio to Janus if connected
                if self.active_connections[connection_id].get("session_id"):
                    await self.send_audio_to_janus(
                        connection_id,
                        processed_audio
                    )
                    
            else:
                # No speech detected - check if we should trigger transcription after silence
                if connection_id in self.active_connections:
                    last_speech_time = self.active_connections[connection_id].get("last_speech_time")
                    if last_speech_time and self.active_connections[connection_id]["audio_buffer"]:
                        silence_duration = time.time() - last_speech_time
                        speech_timeout = self.active_connections[connection_id]["speech_timeout"]
                        
                        if silence_duration >= speech_timeout:
                            logger.info(f"Silence timeout reached for {connection_id}, triggering transcription")
                            await self._process_buffered_audio(connection_id)
                
        except Exception as e:
            logger.error(f"Error handling audio chunk: {str(e)}")
    
    async def _check_transcription_trigger(self, connection_id: str):
        """Check if we should trigger transcription based on buffer state."""
        try:
            if connection_id not in self.active_connections:
                return
            
            connection = self.active_connections[connection_id]
            audio_buffer = connection["audio_buffer"]
            
            if not audio_buffer:
                return
            
            # Calculate total buffered audio duration
            from app.services.audio_service import audio_service
            total_audio = b"".join(audio_buffer)
            duration_ms = audio_service.get_audio_duration(total_audio)
            duration_seconds = duration_ms / 1000.0
            
            # Trigger transcription if buffer exceeds maximum duration
            if duration_seconds >= connection["max_buffer_duration"]:
                logger.info(f"Max buffer duration reached for {connection_id}, triggering transcription")
                await self._process_buffered_audio(connection_id)
                
        except Exception as e:
            logger.error(f"Error checking transcription trigger: {str(e)}")
    
    async def _process_buffered_audio(self, connection_id: str):
        """Process buffered audio for transcription."""
        try:
            if connection_id not in self.active_connections:
                return
            
            connection = self.active_connections[connection_id]
            audio_buffer = connection["audio_buffer"]
            
            if not audio_buffer:
                return
            
            # Combine audio chunks
            combined_audio = b"".join(audio_buffer)
            
            # Check minimum duration requirement
            from app.services.audio_service import audio_service
            duration_ms = audio_service.get_audio_duration(combined_audio)
            duration_seconds = duration_ms / 1000.0
            
            if duration_seconds < connection["min_audio_duration"]:
                logger.debug(f"Audio too short ({duration_seconds:.3f}s), skipping transcription for {connection_id}")
                # Clear buffer anyway to prevent accumulation of very short clips
                connection["audio_buffer"] = []
                connection["last_speech_time"] = None
                return
            
            # Clear buffer first
            connection["audio_buffer"] = []
            connection["last_speech_time"] = None
            
            logger.info(f"Processing {duration_seconds:.3f}s of audio for transcription from {connection_id}")
            
            # Trigger transcription
            await self.handle_transcription_request(connection_id, {
                "language": "en",
                "prompt": None
            }, combined_audio)
            
        except Exception as e:
            logger.error(f"Error processing buffered audio: {str(e)}")
    
    async def handle_transcription_request(
        self,
        connection_id: str,
        data: Dict[str, Any],
        pre_combined_audio: Optional[bytes] = None
    ):
        """Handle transcription request."""
        try:
            if connection_id not in self.active_connections:
                return
            
            # Use pre-combined audio if provided, otherwise combine from buffer
            if pre_combined_audio:
                combined_audio = pre_combined_audio
            else:
                audio_buffer = self.active_connections[connection_id].get("audio_buffer", [])
                if not audio_buffer:
                    return
                
                # Combine audio chunks
                combined_audio = b"".join(audio_buffer)
                
                # Clear buffer
                self.active_connections[connection_id]["audio_buffer"] = []
            
            # Transcribe audio
            from app.services.asr_service import asr_service
            from app.models.audio import TranscriptionRequest
            
            request = TranscriptionRequest(
                audio_data=combined_audio,
                language=data.get("language", "en"),
                prompt=data.get("prompt")
            )
            
            # PCM audio data needs WAV conversion
            response = await asr_service.transcribe_audio(request, is_raw_pcm=True)
            
            # Send transcription result back
            await self.send_websocket_message(connection_id, {
                "type": "transcription_response",
                "success": response.success,
                "text": response.text,
                "language": response.language,
                "confidence": response.confidence,
                "error": response.error
            })
            
        except Exception as e:
            logger.error(f"Error handling transcription request: {str(e)}")
    
    async def handle_chat_request(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """Handle chat request."""
        try:
            from app.services.llm_service import llm_service
            from app.models.chat import ChatRequest
            
            request = ChatRequest(
                message=data.get("message", ""),
                conversation_id=data.get("conversation_id"),
                model=data.get("model"),
                temperature=data.get("temperature", 0.7),
                max_tokens=data.get("max_tokens", 1000),
                system_prompt=data.get("system_prompt")
            )
            
            response = await llm_service.generate_response(request)
            
            # Send chat response back
            await self.send_websocket_message(connection_id, {
                "type": "chat_response",
                "success": response.success,
                "message": response.message,
                "conversation_id": response.conversation_id,
                "message_id": response.message_id,
                "model_used": response.model_used,
                "tokens_used": response.tokens_used,
                "error": response.error
            })
            
        except Exception as e:
            logger.error(f"Error handling chat request: {str(e)}")
    
    async def handle_tts_request(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """Handle TTS request with non-blocking processing."""
        try:
            # Send immediate acknowledgment to prevent timeout
            await self.send_websocket_message(connection_id, {
                "type": "tts_processing",
                "success": True,
                "message": "TTS processing started..."
            })
            
            # Process TTS in background task with timeout
            asyncio.create_task(self._process_tts_background(connection_id, data))
            
        except Exception as e:
            logger.error(f"Error handling TTS request: {str(e)}")
            await self.send_websocket_message(connection_id, {
                "type": "tts_response",
                "success": False,
                "error": f"TTS request failed: {str(e)}"
            })
    
    async def _process_tts_background(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """Process TTS in background with timeout."""
        try:
            from app.services.tts_service import tts_service
            from app.models.tts import TTSRequest
            
            request = TTSRequest(
                text=data.get("text", ""),
                voice=data.get("voice", "en-US-Neural2-F"),
                language=data.get("language", "en-US"),
                speed=data.get("speed", 1.0),
                pitch=data.get("pitch", 0.0),
                volume=data.get("volume", 0.0)
            )
            
            # Add timeout to TTS processing (10 seconds max)
            try:
                response = await asyncio.wait_for(
                    tts_service.synthesize_speech(request),
                    timeout=10.0
                )
                
                # Send TTS response back
                await self.send_websocket_message(connection_id, {
                    "type": "tts_response",
                    "success": response.success,
                    "audio_data": response.audio_data.hex() if response.audio_data else None,
                    "duration_ms": response.duration_ms,
                    "word_count": response.word_count,
                    "voice_used": response.voice_used,
                    "error": response.error
                })
                
            except asyncio.TimeoutError:
                logger.warning(f"TTS timeout for connection {connection_id}, sending text-only response")
                await self.send_websocket_message(connection_id, {
                    "type": "tts_response",
                    "success": False,
                    "error": "TTS timeout - audio generation took too long",
                    "fallback_text": data.get("text", ""),
                    "timeout": True
                })
            
        except Exception as e:
            logger.error(f"Error processing TTS in background: {str(e)}")
            await self.send_websocket_message(connection_id, {
                "type": "tts_response",
                "success": False,
                "error": f"TTS processing failed: {str(e)}"
            })
    
    async def handle_rating(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """Handle user rating."""
        try:
            rating = data.get("rating")
            message_id = data.get("message_id")
            conversation_id = data.get("conversation_id")
            
            # Store rating in database (implement as needed)
            logger.info(f"Received rating {rating} for message {message_id} in conversation {conversation_id}")
            
            # Send confirmation back
            await self.send_websocket_message(connection_id, {
                "type": "rating_confirmation",
                "success": True,
                "message": "Rating received successfully"
            })
            
        except Exception as e:
            logger.error(f"Error handling rating: {str(e)}")
    
    async def send_websocket_message(
        self,
        connection_id: str,
        data: Dict[str, Any]
    ):
        """Send JSON message to WebSocket client."""
        try:
            if connection_id not in self.websocket_connections:
                logger.warning(f"Attempted to send message to non-existent connection: {connection_id}")
                return
                
            websocket = self.websocket_connections[connection_id]
            
            # Check if websocket is still connected
            if websocket.client_state.name == "DISCONNECTED":
                logger.warning(f"Attempted to send message to disconnected WebSocket: {connection_id}")
                # Clean up disconnected connection
                await self._cleanup_connection(connection_id)
                return
            
            # Add connection ID to the message for client validation
            data["server_connection_id"] = connection_id
            
            await websocket.send_text(json.dumps(data))
            logger.debug(f"Sent message to {connection_id}: {data.get('type', 'unknown')}")
            
        except Exception as e:
            logger.error(f"Error sending WebSocket message to {connection_id}: {str(e)}")
            # Clean up problematic connection
            await self._cleanup_connection(connection_id)
    
    async def send_audio_to_janus(
        self,
        connection_id: str,
        audio_data: bytes
    ):
        """Send audio data to Janus WebRTC gateway."""
        try:
            # Implementation depends on Janus WebRTC API
            # This is a placeholder for the actual implementation
            logger.debug(f"Sending audio to Janus for connection {connection_id}")
            
        except Exception as e:
            logger.error(f"Error sending audio to Janus: {str(e)}")
    
    async def broadcast_message(self, data: Dict[str, Any]):
        """Broadcast message to all connected clients."""
        disconnected = []
        
        for connection_id, websocket in self.websocket_connections.items():
            try:
                await websocket.send_text(json.dumps(data))
            except Exception as e:
                logger.error(f"Error broadcasting to {connection_id}: {str(e)}")
                disconnected.append(connection_id)
        
        # Remove disconnected clients
        for connection_id in disconnected:
            await self._cleanup_connection(connection_id)
    
    def _start_silence_checker(self):
        """Start the background task for checking silence timeouts."""
        try:
            loop = asyncio.get_event_loop()
            self._silence_check_task = loop.create_task(self._silence_check_loop())
        except RuntimeError:
            # No event loop running yet, will be started later
            pass
    
    async def _silence_check_loop(self):
        """Background loop to check for silence timeouts."""
        while True:
            try:
                await asyncio.sleep(0.5)  # Check every 500ms
                current_time = time.time()
                
                # Check all connections for silence timeouts
                connections_to_process = []
                for connection_id, connection in self.active_connections.items():
                    last_speech_time = connection.get("last_speech_time")
                    if (last_speech_time and 
                        connection["audio_buffer"] and 
                        current_time - last_speech_time >= connection["speech_timeout"]):
                        connections_to_process.append(connection_id)
                
                # Process connections that have timed out
                for connection_id in connections_to_process:
                    logger.info(f"Background silence timeout detected for {connection_id}")
                    await self._process_buffered_audio(connection_id)
                    
            except Exception as e:
                logger.error(f"Error in silence check loop: {str(e)}")
                await asyncio.sleep(1.0)  # Wait longer on error


    async def _cleanup_connection(self, connection_id: str):
        """Clean up a specific connection."""
        try:
            if connection_id in self.websocket_connections:
                del self.websocket_connections[connection_id]
                logger.debug(f"Removed WebSocket connection: {connection_id}")
            
            if connection_id in self.active_connections:
                del self.active_connections[connection_id]
                logger.debug(f"Removed active connection state: {connection_id}")
                
        except Exception as e:
            logger.error(f"Error cleaning up connection {connection_id}: {str(e)}")
    
    async def get_connection_stats(self) -> Dict[str, Any]:
        """Get current connection statistics."""
        return {
            "total_websocket_connections": len(self.websocket_connections),
            "total_active_connections": len(self.active_connections),
            "websocket_connection_ids": list(self.websocket_connections.keys()),
            "active_connection_ids": list(self.active_connections.keys()),
        }


# Global streaming service instance
streaming_service = StreamingService() 