import Parser from 'tree-sitter';
import Cog from 'tree-sitter-cog';

export const parser = new Parser();
parser.setLanguage(Cog);


