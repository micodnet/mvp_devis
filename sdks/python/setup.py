from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="devis-express-pro",
    version="1.0.0",
    description="SDK Python officiel pour l'API Devis Express Pro",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Micodnet",
    url="https://mvp-devis.onrender.com",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent"
    ]
)