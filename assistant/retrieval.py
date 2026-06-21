import os
import pandas as pd
import chromadb
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# Load the .env file so we can use GEMINI_API_KEY later
load_dotenv()
def load_catalogue(path="data/catalogue.csv"):
    """
    Reads the CSV file and returns it as a list of dictionaries.
    Each dictionary = one product (one row in CSV)
    """
    df = pd.read_csv(path)
    return df.to_dict(orient="records")

def build_index(catalogue):
    """
    Takes all 600 products and stores them in ChromaDB.
    We convert each product's text into a number (embedding)
    so we can search by meaning later.
    """

    # This model converts text into numbers
    # It runs locally on your computer, no API needed
    model = SentenceTransformer("all-MiniLM-L6-v2")

    # Create a ChromaDB database in a local folder called 'chroma_store'
    client = chromadb.PersistentClient(path="chroma_store")

    # Delete old collection if it exists (so we start fresh)
    try:
        client.delete_collection("catalogue")
    except:
        pass

    # Create a new collection (like a table in a database)
    collection = client.create_collection("catalogue")

    # For each product, create a text description and convert to number
    texts = []
    ids = []
    metadatas = []

    for product in catalogue:
        # Combine important fields into one searchable text
        text = f"{product['name']} {product['category']} {product['brand']} {product['vehicle_fitment']} {product['description']}"
        texts.append(text)
        ids.append(product['sku'])
        metadatas.append({
            "sku": product['sku'],
            "name": product['name'],
            "category": product['category'],
            "brand": product['brand'],
            "vehicle_fitment": product['vehicle_fitment'],
            "price_inr": int(product['price_inr']),
            "stock": int(product['stock']),
            "description": product['description']
        })

    # Convert all texts to numbers (embeddings) at once
    print("Creating embeddings... this takes 1-2 minutes first time")
    embeddings = model.encode(texts).tolist()

    # Store everything in ChromaDB
    collection.add(
        documents=texts,
        embeddings=embeddings,
        ids=ids,
        metadatas=metadatas
    )

    print(f"Indexed {len(catalogue)} products successfully!")
    return collection, model

def search_catalogue(query, collection, model, top_k=5):
    """
    Takes a dealer's question, converts it to a number,
    finds the top_k most similar products in ChromaDB.
    
    Example:
        query = "brake pads for Pulsar 150"
        returns = 5 most relevant products
    """

    # Convert the question into a number
    query_embedding = model.encode([query]).tolist()

    # Search ChromaDB for closest matches
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=top_k
    )

    # Format results nicely
    products = []
    for i in range(len(results['ids'][0])):
        products.append(results['metadatas'][0][i])

    return products


def load_index():
    """
    After the first time we build the index, we can just load it.
    No need to re-embed 600 products every time we run the assistant.
    """
    model = SentenceTransformer("all-MiniLM-L6-v2")
    client = chromadb.PersistentClient(path="chroma_store")
    collection = client.get_collection("catalogue")
    return collection, model