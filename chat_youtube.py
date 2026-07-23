# Import Required Libraries
import tempfile
import streamlit as st
from embedchain import App


# Configure the Embedchain App
def embedchain_bot(db_path, api_key):
    """Create and configure an Embedchain App instance.

    Uses OpenAI's GPT-4o as the LLM, ChromaDB as the vector database,
    and OpenAI embeddings for generating vector embeddings.
    """
    return App.from_config(
        config={
            "llm": {
                "provider": "openai",
                "config": {
                    "model": "gpt-4o",
                    "temperature": 0.5,
                    "api_key": api_key,
                },
            },
            "vectordb": {
                "provider": "chroma",
                "config": {"dir": db_path},
            },
            "embedder": {
                "provider": "openai",
                "config": {"api_key": api_key},
            },
        }
    )


# Set up the Streamlit App
st.title("Chat with YouTube Video 📺")
st.caption("This app allows you to chat with a YouTube video using OpenAI API")

# Get the OpenAI API key from the user
openai_access_token = st.text_input("OpenAI API Key", type="password")

# Initialize the Embedchain App once the API key is provided
if openai_access_token:
    # Create a temporary directory for the vector database
    db_path = tempfile.mkdtemp()
    # Initialize the Embedchain app
    app = embedchain_bot(db_path, openai_access_token)

    # Get the YouTube Video URL from the user
    video_url = st.text_input("Enter YouTube Video URL", type="default")
    if video_url:
        # Add the video to the knowledge base
        app.add(video_url, data_type="youtube_video")
        st.success(f"Added {video_url} to knowledge base!")

        # Ask a question about the YouTube video
        prompt = st.text_input("Ask any question about the YouTube Video")
        if prompt:
            # Get the answer from the Embedchain app and display it
            answer = app.chat(prompt)
            st.write(answer)
