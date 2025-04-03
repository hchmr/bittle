# Bittle

[![CI](https://github.com/hchmr/bittle/actions/workflows/ci.yml/badge.svg)](https://github.com/hchmr/bittle/actions/workflows/ci.yml)

Bittle is a simple programming language inspired by C, designed for simplicity and expressiveness. It's a hobby project that serves as a playground for exploring programming language design and implementation. The goal of this project is to create a language that's simple like C but more fun, while also providing a platform to learn about compiler techniques and language tooling.

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
- Modularity:
    - Separate compilation of modules.
- Value and reference semantics:
    - All types are passed by value and returned by value.
    - Pointers can be used for reference semantics.
- Other:
    - Pointed-to values are immutable by default.
    - Memory is managed manually. Support for dynamic memory allocation using externally provided functions.

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

The language is self-hosting, meaning that the compiler is written in Bittle and can compile itself. More details on bootstrapping are provided below. The only supported platform is Linux on Arm64. The compiler is fairly basic, generating very inefficient assembly code and halts on the first error. Dynamically allocated memory is handled carelessly, but for a short-lived process like a compiler, memory leaks are of no concern.

### Language Extension

The language extension for Visual Studio Code provides the following features:

- Syntax highlighting
- Diagnostics (errors, warnings, etc.)
- Symbol tree navigation and symbol search
- Jump to definition, implementation, and type definition
- References and renaming
- Code completion
- Signature help during function calls

## More examples

**Binary Search**
```
func binary_search(xs: *Int, n: Int, key: Int): Int {
    var lo = 0;
    var hi = n;
    while (lo < hi) {
        var mid = (hi - lo) / 2 + lo;
        if (xs[mid] < key) {
            lo = mid + 1;
        } else if (xs[mid] > key) {
            hi = mid;
        } else {
            return mid;
        }
    }
    return -lo - 1;
}
```

**Linked List**
```
struct LinkedList {
    head: *mut ListNode,
    tail: *mut ListNode,
}

struct ListNode {
    prev: *mut ListNode,
    next: *mut ListNode,
    value: *Void,
}

func list_reverse(list: *mut LinkedList) {
    var curr = list.head;
    var prev: *mut ListNode = null;
    while (curr != null) {
        var next = curr.next;
        curr.next = prev;
        curr.prev = next;
        prev = curr;
        curr = next;
    }
    list.tail = list.head;
    list.head = prev;
}
```

**Shape Union**
```
enum ShapeKind {
    Shape_Circle,
    Shape_Square,
}

struct Circle {
    kind: ShapeKind = Shape_Circle,
    radius: Int,
}

struct Square {
    kind: ShapeKind = Shape_Square,
    side: Int,
}

union Shape {
    kind: ShapeKind,
    Circle: Circle,
    Square: Square,
}

func area(shape: *Shape): Int {
    match (shape.kind) {
        case Shape_Circle:
            return 3 * shape.Circle.radius * shape.Circle.radius;
        case Shape_Square:
            return shape.Square.side * shape.Square.side;
        case _:
            return -1;
    }
}
```

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
- A small standard library
- More expressive pattern matching
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
