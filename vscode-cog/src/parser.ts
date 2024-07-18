import Parser from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import { Query } from 'tree-sitter';

export const parser = new Parser();
parser.setLanguage(Cog);