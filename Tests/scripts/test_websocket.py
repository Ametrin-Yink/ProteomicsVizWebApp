"""Test WebSocket connection to backend."""
import asyncio
import websockets
import json

async def test_websocket():
    session_id = "3bc164fc-f90b-4cfd-abc8-b3069ff3fb74"
    uri = f"ws://127.0.0.1:8000/ws/sessions/{session_id}"

    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected!")

            # Send subscribe message
            await websocket.send(json.dumps({
                "type": "subscribe",
                "payload": {"session_id": session_id}
            }))
            print("Subscribe message sent")

            # Wait for messages
            for i in range(5):
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=5)
                    print(f"Received: {message}")
                except asyncio.TimeoutError:
                    print("Timeout waiting for message")
                    break

            print("Test completed successfully!")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())
