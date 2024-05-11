stage0-compile:
    mkdir -p out/stage0
    @echo "Compiling stage0"
    cmake --build ./bootstrap/cmake-build-debug
    cp bootstrap/cmake-build-debug/cog0 out/stage0/cog0

stage0-dbg:
    @just stage0-compile
    lldb --source scripts/stage0.lldb

stage0:
    @just stage0-compile
    lldb --source scripts/stage0.lldb -o quit

stage1-compile:
    @just stage0-compile
    mkdir -p out/stage1
    @echo "Compiling stage1"
    @echo "Generating assembly"
    bootstrap/cmake-build-debug/cog0 < self-host/main.cog > out/stage1/main.s
    @echo "Assembling"
    as -g -o out/stage1/main.o out/stage1/main.s
    @echo "Linking"
    ld -lSystem -syslibroot "$(xcrun -sdk macosx --show-sdk-path)" -o out/stage1/cog1 out/stage1/main.o

stage1-dbg:
    @just stage1-compile
    lldb --source scripts/stage1.lldb

stage1:
    @just stage1-compile
    lldb --source scripts/stage1.lldb -o run -o quit

stage2-compile:
    @just stage1-compile
    mkdir -p out/stage2
    @echo "Compiling stage2"
    @echo "Generating assembly"
    out/stage1/cog1 < self-host/main.cog > out/stage2/main.s
    @echo "Assembling"
    as -g -o out/stage2/main.o out/stage2/main.s
    @echo "Linking"
    ld -lSystem -syslibroot "$(xcrun -sdk macosx --show-sdk-path)" -o out/stage2/cog2 out/stage2/main.o

stage2:
    @just stage2-compile
    ./out/stage2/cog2 < self-host/main.cog

stage3:
    @just stage2-compile
    mkdir -p out/stage3
    @echo "Compiling stage3"
    @echo "Generating assembly"
    out/stage2/cog2 < self-host/main.cog > out/stage3/main.s
    @echo "Assembling"
    as -g -o out/stage3/main.o out/stage3/main.s
    @echo "Linking"
    ld -lSystem -syslibroot "$(xcrun -sdk macosx --show-sdk-path)" -o out/stage3/cog3 out/stage3/main.o

    @echo "Comparing stage2 and stage3"
    diff out/stage2/main.s out/stage3/main.s && echo "No difference"
