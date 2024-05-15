COGC = cogc
SRC = main.cog
BUILD_DIR ?= .
TARGET = $(BUILD_DIR)/cogc

build: $(TARGET)

$(TARGET).s: $(SRC)
	@echo "Generating assembly code"
	$(COGC) <$(SRC) >$(TARGET).s

$(TARGET).o: $(TARGET).s
	@echo "Compiling assembly"
	gcc -g -c -o $(TARGET).o $(TARGET).s

$(TARGET): $(TARGET).o
	@echo "Linking executable"
	gcc -g -o $(TARGET) $(TARGET).o
