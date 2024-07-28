export enum CompositeNodeKind {
    // Root
    Root = 'Root',
    // Top-level declarations
    IncludeDecl = 'IncludeDecl',
    EnumDecl = 'EnumDecl',
    EnumMember = 'EnumMember',
    StructDecl = 'StructDecl',
    StructMember = 'StructMember',
    FuncDecl = 'FuncDecl',
    FuncParam = 'FuncParam',
    GlobalDecl = 'GlobalDecl',
    ConstDecl = 'ConstDecl',
    // Statements
    BlockStmt = 'BlockStmt',
    VarStmt = 'VarStmt',
    IfStmt = 'IfStmt',
    WhileStmt = 'WhileStmt',
    ReturnStmt = 'ReturnStmt',
    BreakStmt = 'BreakStmt',
    ContinueStmt = 'ContinueStmt',
    ExprStmt = 'ExprStmt',
    // Expressions
    GroupExpr = 'GroupExpr',
    NameExpr = 'NameExpr',
    LiteralExpr = 'LiteralExpr',
    UnaryExpr = 'UnaryExpr',
    BinaryExpr = 'BinaryExpr',
    TernaryExpr = 'TernaryExpr',
    CallExpr = 'CallExpr',
    IndexExpr = 'IndexExpr',
    FieldExpr = 'FieldExpr',
    CastExpr = 'CastExpr',
    SizeofExpr = 'SizeofExpr',
    // Types
    GroupType = 'GroupType',
    NameType = 'NameType',
    PointerType = 'PointerType',
    ArrayType = 'ArrayType',
    // Literals
    IntLiteral = 'IntLiteral',
    StringLiteral = 'StringLiteral',
    CharLiteral = 'CharLiteral',
    // Error
    Error = 'Error',
}
