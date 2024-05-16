# Cog

Cog is a small language inspired by C, with a focus on simplicity and expressiveness. It is designed for experimenting with programming language design and implementation with a focus on bootstrapping and writing algorithms.

## Bootstrapping

Cog is a self-hosted language, meaning that the compiler is written in Cog itself. The initial implementation of the compiler was written in C and then rewritten in Cog. Subsequent versions of the compiler will be written in Cog and be bootstrapped from the previous version. This is done to avoid having to maintain two separate compilers. This strategy implies that there is a bootstrapping chain of compilers, where each compiler is written in the previous version of the language. The chain is maintained by a bootstrapping script which builds the compiler entirely from source. Previous versions of the compiler are retrieved from the git history of the source repository.