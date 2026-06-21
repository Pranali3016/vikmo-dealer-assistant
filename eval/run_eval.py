import sys
import os
import json

# Make sure we can import from parent folder
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from assistant.agent import setup_groq, setup_rag, run_agent

def run_eval():
    print("=" * 60)
    print("VIKMO ASSISTANT — EVALUATION")
    print("=" * 60)

    # Load test cases
    eval_path = os.path.join(os.path.dirname(__file__), "eval_set.json")
    with open(eval_path) as f:
        test_cases = json.load(f)

    # Setup
    client = setup_groq()
    collection, embed_model = setup_rag()

    results = []

    for tc in test_cases:
        print(f"\n[{tc['id']}] {tc['description']}")
        print(f"Input: {tc['input']}")

        # Fresh history for each test (no cross-contamination)
        chat_history = []

        try:
            reply, _ = run_agent(
                user_message=tc["input"],
                chat_history=chat_history,
                collection=collection,
                embed_model=embed_model,
                client=client
            )

            reply_lower = reply.lower()

            # Check 1 — keywords present in reply?
            keywords_found = all(
                kw.lower() in reply_lower
                for kw in tc["expected_keywords"]
            )

            # Check 2 — decline check
            decline_phrases = ["only help with", "only assist with", "can only help", "auto parts and orders"]
            actually_declined = any(p in reply_lower for p in decline_phrases)

            if tc["should_decline"]:
                passed = actually_declined
            else:
                passed = keywords_found

            status = "✅ PASS" if passed else "❌ FAIL"
            print(f"Reply: {reply[:120]}...")
            print(f"Result: {status}")

            results.append({
                "id": tc["id"],
                "category": tc["category"],
                "passed": passed,
                "reply_preview": reply[:200]
            })

        except Exception as e:
            print(f"Result: ❌ ERROR — {e}")
            results.append({
                "id": tc["id"],
                "category": tc["category"],
                "passed": False,
                "reply_preview": f"ERROR: {e}"
            })

    # Print summary
    print("\n" + "=" * 60)
    print("EVALUATION SUMMARY")
    print("=" * 60)

    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed

    print(f"Total Tests : {total}")
    print(f"Passed      : {passed}")
    print(f"Failed      : {failed}")
    print(f"Score       : {passed}/{total} ({round(passed/total*100)}%)")

    # Breakdown by category
    print("\nBy Category:")
    categories = set(r["category"] for r in results)
    for cat in sorted(categories):
        cat_results = [r for r in results if r["category"] == cat]
        cat_passed = sum(1 for r in cat_results if r["passed"])
        print(f"  {cat}: {cat_passed}/{len(cat_results)}")

    # Save results to file
    output_path = os.path.join(os.path.dirname(__file__), "eval_results.json")
    with open(output_path, "w") as f:
        json.dump({
            "total": total,
            "passed": passed,
            "failed": failed,
            "score_percent": round(passed/total*100),
            "results": results
        }, f, indent=2)

    print(f"\nResults saved to eval/eval_results.json")
    print("=" * 60)


if __name__ == "__main__":
    run_eval()