# Bittle

[![CI](https://github.com/hchmr/bittle/actions/workflows/ci.yml/badge.svg)](https://github.com/hchmr/bittle/actions/workflows/ci.yml)

Bittle is a minimalist programming language inspired by C, designed for simplicity and expressiveness. It's a hobby project that serves as a playground for exploring programming language design and implementation. The goal is to create a language that's as simple as C but more fun, while also providing a platform to learn about compiler techniques and language tooling.

## Feature overview

### Language

Bittle resembles a smaller, more modern C, with the following core features:

- Data types:
    - Primitives: Booleans and integers.
    - Derived Types: Pointers and fixed-length arrays.
    - User-Defined Types: Structures and enumerations.
- Procedural building blocks:
    - Structured control flow with `if`, `while`, `for`, `break`, etc.
    - Functions
    - Local and global variables

Bittle supports separate compilation for modular programming, using header files to reference symbols from other units (for now).

Bittle can also interoperate with C. Currently, there’s no standard library, so basic functionality like I/O is best handled via libc.

**Example: "Hello, World!"**

```
extern func printf(fmt: *Char, ...): Int32;

func main(): Int32 {
    printf("Hello, world!");
    return 0;
}
```

### Compiler

The compiler is self-hosting, meaning its compiler is written in Bittle itself. The only supported platform is Arm64 Linux, which was chosen because it is an easily available, reproducible environment to bootstrap the compiler. The compiler is fairly basic, emitting naive Arm assembly code directly to stdout and halting on the first error encountered. Memory management is minimal—no deallocation, but given that the compiler is short-lived, this is fine.

### Language Extension

The language extension for Visual Studio Code provides the following features:

- Syntax highlighting
- Diagnostics (errors, warnings, etc.)
- Symbol tree navigation and symbol search
- Jump to definition, implementation, and type definition
- References and renaming
- Code completion
- Signature help during function calls

## Bootstrapping

The initial implementation of the compiler was written in C and then rewritten in Bittle. Subsequent versions of the compiler are written in Bittle and are bootstrapped from the previous version. This is done to avoid having to maintain two separate compilers. This strategy implies a bootstrapping chain of compilers, where each compiler is written in the previous version of the language. The chain is maintained by a bootstrapping script which builds the compiler entirely from source. Previous versions of the compiler are retrieved from the git history of the source repository.

To build from source, you will need a system running Arm64 Linux with the following software installed: GCC, Make, Bash, and Git. The bootstrapping script in the `scripts` directory checks out each revision in the bootstrap chain, builds the compiler using the previous version, and eventually produces a fully bootstrapped executable verified against itself.

## Status

### Language

**Missing Features:**

- No floating-point support
- No support for control flow labels

**Planned Enhancements:**

- Basic generics with type parameters
- Module system with export/import (replacing header files)
- A standard library
- Unions
- Switch statements

### Compiler

**Missing Features:**

- Limited static analysis (e.g., no definite return analysis)

**Planned Enhancements:**

- New backend with optimization and register allocation
- Produce DWARF debugging info
- Support for additional platforms
- Improved diagnostics and analysis

### Language Extension

**Planned Enhancements:**

- Improved diagnostics and analysis
- Code formatting tools
- Basic refactoring support
- Better support for larger projects
- Editor-independent language server

## Acknowledgements

Special thanks to the following sources for their influence and inspiration:

- [Ion](https://github.com/pervognsen/bitwise/blob/master/noir/noir/noir.ion) by Per Vognesen: A minimalist language from the now-abandoned Bitwise project.
- [chibicc](https://github.com/rui314/chibicc) by Rui Ueyama: A minimalist C compiler from scratch.
- Many insights from Alex Kladov on how to write parsers and IDEs, including:
    - [rust-analyzer](https://rust-analyzer.github.io/): Rust's IDE engine.
    - [Resilient LL Parsing Tutorial](https://matklad.github.io/2023/05/21/resilient-ll-parsing-tutorial.html): An insightful guide to creating robust LL parsers.
    - [ungrammar](https://rust-analyzer.github.io/blog/2020/10/24/introducing-ungrammar.html): A new formalism for describing concrete syntax trees.

GitHub Copilot was used in the development of this project.
