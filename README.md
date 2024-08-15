# Cog

Cog is a small language inspired by C, with a focus on simplicity and expressiveness. It is designed for experimenting with programming language design and implementation with a focus on bootstrapping and writing algorithms.

## Bootstrapping

Cog is a self-hosted language, meaning that the compiler is written in Cog itself. The initial implementation of the compiler was written in C and then rewritten in Cog. Subsequent versions of the compiler will be written in Cog and be bootstrapped from the previous version. This is done to avoid having to maintain two separate compilers. This strategy implies that there is a bootstrapping chain of compilers, where each compiler is written in the previous version of the language. The chain is maintained by a bootstrapping script which builds the compiler entirely from source. Previous versions of the compiler are retrieved from the git history of the source repository.

## Acknowledgements

I’ve taken a lot of ideas from various places to create this project. Here are a few sources that have been especially influential:

- [Ion](https://github.com/pervognsen/bitwise/blob/master/noir/noir/noir.ion) by Per Vognesen: A minimalist language from the now-abandoned Bitwise project.
- [chibicc](https://github.com/rui314/chibicc) by Rui Ueyama: A minimalist C compiler from scratch.
- Many insights from Alex Kladov's on how to write parsers and IDEs, including:
    - [rust-analyzer](https://rust-analyzer.github.io/): Rust's IDE engine.
    - [Resilient LL Parsing Tutorial](https://matklad.github.io/2023/05/21/resilient-ll-parsing-tutorial.html): An insightful guide to creating robust LL parsers.
    - [ungrammar](https://rust-analyzer.github.io/blog/2020/10/24/introducing-ungrammar.html): A new formalism for describing concrete syntax trees.

Also, GitHub Copilot was used in the development of this project.
