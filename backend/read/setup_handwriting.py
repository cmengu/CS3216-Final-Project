"""Provision optional local OCR weights outside request handling."""


def main():
    from huggingface_hub import snapshot_download

    from .orientation import _classifier

    _classifier()
    path = snapshot_download("PaddlePaddle/PaddleOCR-VL-1.5")
    print(f"Handwriting model ready at {path}")
    print("Bounded region recovery will use these cached weights automatically.")


if __name__ == "__main__":
    main()
