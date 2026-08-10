import os
import pandas as pd
import numpy as np
from dotenv import load_dotenv

load_dotenv()

class LightweightCatalogueIndex:
    """
    Ultra-lightweight, memory-efficient vector search index (< 40MB RAM).
    Uses TF-IDF n-gram vectorization with Cosine Similarity over product metadata.
    Avoids heavy PyTorch / SentenceTransformer overhead to run seamlessly on 512MB RAM cloud tiers.
    """
    def __init__(self, catalogue=None):
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
        
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english")
        self.catalogue = catalogue or []
        self.matrix = None
        
        if self.catalogue:
            self._fit()

    def _fit(self):
        texts = [
            f"{p.get('name', '')} {p.get('category', '')} {p.get('brand', '')} {p.get('vehicle_fitment', '')} {p.get('description', '')}"
            for p in self.catalogue
        ]
        self.matrix = self.vectorizer.fit_transform(texts)

    def query(self, query_text, top_k=5):
        from sklearn.metrics.pairwise import cosine_similarity
        
        if not self.catalogue or self.matrix is None:
            return []
            
        q_vec = self.vectorizer.transform([query_text])
        sims = cosine_similarity(q_vec, self.matrix)[0]
        
        # Get top-k indices
        top_indices = sims.argsort()[-top_k:][::-1]
        
        results = []
        for idx in top_indices:
            results.append(self.catalogue[idx])
        return results


def load_catalogue(path="data/catalogue.csv"):
    """
    Reads the CSV file and returns it as a list of dictionaries.
    """
    if not os.path.exists(path):
        return []
    df = pd.read_csv(path)
    return df.to_dict(orient="records")


def build_index(catalogue):
    """
    Builds the lightweight vector index in memory (< 0.05 seconds).
    """
    index = LightweightCatalogueIndex(catalogue)
    return index, "lightweight-tfidf-v1"


def load_index():
    """
    Loads catalogue and initializes index.
    """
    catalogue = load_catalogue()
    return build_index(catalogue)


def search_catalogue(query, collection, model=None, top_k=5):
    """
    Takes a dealer's question and finds the top_k most similar products.
    Compatible with both LightweightCatalogueIndex and ChromaDB collections.
    """
    if isinstance(collection, LightweightCatalogueIndex):
        return collection.query(query, top_k=top_k)
        
    # If ChromaDB collection object was passed
    if hasattr(collection, "query") and model is not None and hasattr(model, "encode"):
        try:
            query_embedding = model.encode([query]).tolist()
            results = collection.query(
                query_embeddings=query_embedding,
                n_results=top_k
            )
            products = []
            for i in range(len(results['ids'][0])):
                products.append(results['metadatas'][0][i])
            return products
        except Exception:
            pass
            
    # Fallback to direct text search
    catalogue = load_catalogue()
    idx, _ = build_index(catalogue)
    return idx.query(query, top_k=top_k)