package tree_sitter_cog_test

import (
	"testing"

	tree_sitter "github.com/smacker/go-tree-sitter"
	"github.com/tree-sitter/tree-sitter-cog"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_cog.Language())
	if language == nil {
		t.Errorf("Error loading Cog grammar")
	}
}
