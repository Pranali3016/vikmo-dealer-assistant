import os
import json
from groq import Groq
from dotenv import load_dotenv
from assistant.retrieval import load_catalogue, build_index, load_index, search_catalogue
from assistant.tools import run_tool
from assistant.prompts import SYSTEM_PROMPT

load_dotenv()

# ─────────────────────────────────────────────
# TOOL DEFINITIONS — Groq format (OpenAI style)
# ─────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_stock",
            "description": "Check stock availability for a specific product SKU.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {
                        "type": "string",
                        "description": "Product SKU e.g. BRK-1042"
                    }
                },
                "required": ["sku"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_parts_by_vehicle",
            "description": "Find parts that fit a specific vehicle make and model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "vehicle": {
                        "type": "string",
                        "description": "Vehicle name e.g. Bajaj Pulsar 150"
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category like Brakes, Filters, Tyres & Tubes"
                    }
                },
                "required": ["vehicle"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_order",
            "description": "Place an order for a dealer with specific SKUs and quantities.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dealer_name": {
                        "type": "string",
                        "description": "Name of the dealer e.g. ABC Motors"
                    },
                    "items": {
                        "type": "array",
                        "description": "List of items to order",
                        "items": {
                            "type": "object",
                            "properties": {
                                "sku": {"type": "string"},
                                "quantity": {"type": "integer"}
                            },
                            "required": ["sku", "quantity"]
                        }
                    }
                },
                "required": ["dealer_name", "items"]
            }
        }
    }
]


# ─────────────────────────────────────────────
# SETUP
# ─────────────────────────────────────────────

def setup_groq():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not found in .env file!")
    client = Groq(api_key=api_key)
    return client


def setup_rag():
    print("Initializing catalogue index...")
    catalogue = load_catalogue()
    collection, embed_model = build_index(catalogue)
    return collection, embed_model


# ─────────────────────────────────────────────
# AGENT LOOP
# ─────────────────────────────────────────────

def run_agent(user_message, chat_history, collection, embed_model, client):
    """
    Handles one dealer message:
    1. RAG  — find relevant products from catalogue
    2. Send to Groq LLM with context
    3. If LLM calls a tool — run it, send result back
    4. Return final reply
    """

    # STEP 1 — RAG: find relevant products
    relevant_products = search_catalogue(
        query=user_message,
        collection=collection,
        model=embed_model,
        top_k=5
    )

    products_text = "\n".join([
        f"- SKU: {p['sku']} | {p['name']} | INR {p['price_inr']} | Stock: {p['stock']} | Fits: {p['vehicle_fitment']}"
        for p in relevant_products
    ])

    # STEP 2 — Attach retrieved products to the message
    augmented_message = f"""Dealer's question: {user_message}

Relevant products from catalogue:
{products_text}"""

    # STEP 3 — Build messages list for Groq
    # System prompt always goes first
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add previous conversation history
    messages.extend(chat_history)

    # Add current message
    messages.append({"role": "user", "content": augmented_message})

    # STEP 4 — Send to Groq, handle tool calls in a loop
    while True:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",  # free, powerful model on Groq
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",  # let AI decide when to use tools
            temperature=0.2
        )

        message = response.choices[0].message

        # Check if AI wants to call a tool
        if message.tool_calls:
            # Add AI's tool call decision to messages
            messages.append(message)

            # Run each tool the AI requested
            for tool_call in message.tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)

                print(f"\n[Tool call: {tool_name}({tool_args})]")

                tool_result = run_tool(tool_name, tool_args)

                print(f"[Result: {tool_result[:120]}]")

                # Add tool result back to messages
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_result
                })

            # Loop again — AI will now form a reply using tool results

        else:
            # AI gave final text reply
            final_reply = message.content

            # Save to chat history (without the RAG context — keep history clean)
            chat_history.append({"role": "user", "content": user_message})
            chat_history.append({"role": "assistant", "content": final_reply})

            return final_reply, chat_history


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    print("Starting VIKMO Assistant...")
    print("=" * 50)

    client = setup_groq()
    collection, embed_model = setup_rag()

    print("\n✅ VIKMO Assistant ready! Type 'quit' to exit.\n")
    print("=" * 50)

    chat_history = []

    while True:
        user_input = input("\nYou: ").strip()

        if not user_input:
            continue

        if user_input.lower() in ["quit", "exit", "bye"]:
            print("Assistant: Thank you! Goodbye 🙏")
            break

        try:
            reply, chat_history = run_agent(
                user_message=user_input,
                chat_history=chat_history,
                collection=collection,
                embed_model=embed_model,
                client=client
            )
            print(f"\nAssistant: {reply}")

        except Exception as e:
            print(f"\n[Error]: {e}")


if __name__ == "__main__":
    main()