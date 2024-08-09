COGC ?= cogc
BUILD_DIR ?= .
COG_HEADERS = $(wildcard *.cogs)
COG_FILES = $(wildcard *.cog)
ASM_FILES = $(patsubst %.cog, $(BUILD_DIR)/%.s, $(COG_FILES))
OBJ_FILES = $(ASM_FILES:.s=.o)

build: $(BUILD_DIR)/cogc

$(BUILD_DIR)/cogc: $(OBJ_FILES)
	gcc -g $^ -o $@

$(BUILD_DIR)/%.o: $(BUILD_DIR)/%.s
	gcc -g -c $< -o $@

.PRECIOUS: $(BUILD_DIR)/%.s
$(BUILD_DIR)/%.s: %.cog $(COG_HEADERS)
	$(COGC) $< > $@
