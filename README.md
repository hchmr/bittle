# Bittle

[![CI](https://github.com/hchmr/bittle/actions/workflows/ci.yml/badge.svg)](https://github.com/hchmr/bittle/actions/workflows/ci.yml)

Bittle is a minimalist programming language inspired by C, designed for simplicity and expressiveness. It's a hobby project that serves as a playground for exploring programming language design and implementation. The goal is to create a language that's as simple as C but more fun, while also providing a platform to learn about compiler techniques and language tooling.

## Feature overview

### Language

Bittle resembles a smaller, more modern C, with the following core features:

- Data types:
    - Primitives: Booleans and integers.
    - Derived Types: Pointers and fixed-length arrays.
    - User-Defined Types: Structures, unions and enumerations.
- Procedural building blocks:
    - Structured control flow with `if`, `while`, `for`, `break`, etc.
    - Procedures.
    - Local and global variables.
- Value and reference semantics:
    - All types are passed by value and returned by value.
    - Pointers can be used for reference semantics.
- Other:
    - Memory is managed manually. Support for dynamic memory allocation using externally provided functions.
    - Separate compilation with external declarations and header files (for now).

Bittle can also interoperate with C. Currently, there is no standard library, so basic functionality like I/O must be provided externally.

**Example: "Hello, World!"**

```
extern func printf(fmt: *Char, ...): Int32;

func main(): Int32 {
    printf("Hello, world!");
    return 0;
}
```

### Compiler

The language is self-hosting, meaning that the compiler is written in Bittle and can compile itself. More details on bootstrapping are provided below. The only supported platform is Linux on Arm64. The compiler is fairly basic, emitting naive assembly code directly to stdout and halting on the first error. Dynamically allocated memory is handled carelessly, but for a short-lived process like a compiler, memory leaks are of no concern.

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

The bootstrapping chain starts with a minimal compiler written in C. Each subsequent version of the compiler is written in Bittle and compiled using the previous version. The chain is maintained by a bootstrapping script that builds the compiler entirely from source. Previous versions of the compiler are retrieved from the git history of the source repository.

The host platform for the bootstrapping process is Linux on Arm64. A minimal set of build dependencies is required: `gcc`, `glibc`, `make`, `git`, and `bash`. The bootstrapping script in the `scripts` directory checks out each revision in the bootstrap chain, builds the compiler using the previous version, and eventually produces a fully bootstrapped executable verified against itself.

## Status

### Language

**Missing Features:**

- No floating-point support
- No support for control flow labels

**Planned Enhancements:**

- Initialization of global variables
- Module system with export/import (replacing header files)
- A small standard library
- Switch statements
- Basic generics with type parameters

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
