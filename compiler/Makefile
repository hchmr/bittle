BITTLEC ?= bittlec
BUILD_DIR ?= .
BITTLE_HEADERS = $(wildcard *.btls)
BITTLE_FILES = $(wildcard *.btl)
ASM_FILES = $(patsubst %.btl, $(BUILD_DIR)/%.s, $(BITTLE_FILES))
OBJ_FILES = $(ASM_FILES:.s=.o)
EXE_FILE = $(BUILD_DIR)/bittlec

build: $(EXE_FILE)

$(EXE_FILE): $(OBJ_FILES)
	gcc -g $^ -o $@

$(BUILD_DIR)/%.o: $(BUILD_DIR)/%.s
	gcc -g -c $< -o $@

.PRECIOUS: $(BUILD_DIR)/%.s
$(BUILD_DIR)/%.s: %.btl $(BITTLE_HEADERS)
	$(BITTLEC) $< > $@

.PHONY: clean
clean:
	rm -f $(EXE_FILE) $(OBJ_FILES) $(ASM_FILES)
