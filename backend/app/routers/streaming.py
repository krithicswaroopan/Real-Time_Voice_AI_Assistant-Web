"""Streaming API router for WebSocket and WebRTC handling."""

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from app.services.streaming_service import streaming_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/streaming", tags=["Streaming"])



@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time audio streaming and chat.
    
    Args:
        websocket: WebSocket connection
    """
    logger.info(f"WebSocket connection attempt from: {websocket.client.host}:{websocket.client.port}")
    try:
        logger.info("Attempting to accept WebSocket connection...")
        await websocket.accept()
        logger.info("WebSocket connection accepted successfully")
        
        # Handle WebSocket connection
        await streaming_service.handle_websocket_connection(websocket, "/ws")
        
    except WebSocketDisconnect as e:
        logger.info(f"WebSocket connection disconnected: {e.code} - {e.reason}")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        try:
            if websocket.client_state.name != "DISCONNECTED":
                await websocket.close(code=1012, reason="Service restart")
        except Exception:
            pass  # Connection may already be closed
    finally:
        logger.info("WebSocket connection cleanup completed")


@router.post("/janus/session")
async def create_janus_session():
    """
    Create a new Janus WebRTC session.
    
    Returns:
        Session information
    """
    try:
        session_id = await streaming_service.create_janus_session()
        
        if session_id:
            return {
                "success": True,
                "session_id": session_id,
                "message": "Janus session created successfully"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to create Janus session"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating Janus session: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error creating Janus session"
        )


@router.post("/janus/room")
async def create_janus_room(session_id: str, room_id: str = None):
    """
    Create a new audio room in Janus.
    
    Args:
        session_id: Janus session ID
        room_id: Optional room ID (will generate if not provided)
        
    Returns:
        Room information
    """
    try:
        room_id = await streaming_service.create_audio_room(session_id, room_id)
        
        if room_id:
            return {
                "success": True,
                "session_id": session_id,
                "room_id": room_id,
                "message": "Audio room created successfully"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to create audio room"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating audio room: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error creating audio room"
        )


@router.get("/connections")
async def get_active_connections():
    """
    Get information about active streaming connections.
    
    Returns:
        Connection statistics
    """
    try:
        stats = await streaming_service.get_connection_stats()
        stats["janus_url"] = streaming_service.janus_url
        return stats
    except Exception as e:
        logger.error(f"Error getting connection info: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve connection information"
        )


@router.get("/health")
async def streaming_health_check():
    """
    Health check for streaming service.
    
    Returns:
        Health status of the streaming service
    """
    try:
        return {
            "status": "healthy",
            "service": "streaming",
            "websocket_connections": len(streaming_service.websocket_connections),
            "active_connections": len(streaming_service.active_connections),
            "janus_configured": bool(streaming_service.janus_url)
        }
    except Exception as e:
        logger.error(f"Streaming health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "service": "streaming",
            "error": str(e),
            "available": False
        } 