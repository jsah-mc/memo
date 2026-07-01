import importlib.metadata

# Intercept the standard library entry point discovery to hide the broken package
original_entry_points = importlib.metadata.entry_points

def patched_entry_points(**kwargs):
    eps = original_entry_points(**kwargs)
    # Filter out any entry point that belongs to the broken package
    if hasattr(eps, 'select'):
        return eps.select(value=lambda v: "spacy_curated_transformers" not in str(v))
    elif isinstance(eps, dict):
        return {group: [ep for ep in items if "spacy_curated_transformers" not in str(ep.value)] 
                for group, items in eps.items()}
    return [ep for ep in eps if "spacy_curated_transformers" not in str(ep.value)]

importlib.metadata.entry_points = patched_entry_points

from utils.program import Program

def main():
    app = Program()
    app.run()

if __name__ == "__main__":
    main()
