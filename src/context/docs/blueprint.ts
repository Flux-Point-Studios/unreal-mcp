/**
 * UE 5.7 Blueprint API Context Documentation
 *
 * Covers Blueprint graph manipulation, K2Node types, pin handling,
 * compilation, and FBlueprintEditorUtils usage.
 */

export const blueprintContext = `
# UE 5.7 Blueprint API Reference

## Core Classes

### UBlueprint
The asset that represents a Blueprint class. Inherits from UBlueprintCore.
- \`UBlueprint::GeneratedClass\` - The UClass generated after compilation.
- \`UBlueprint::ParentClass\` - The native or Blueprint parent class.
- \`UBlueprint::NewVariables\` - TArray<FBPVariableDescription> of user-defined variables.
- \`UBlueprint::FunctionGraphs\` - TArray<UEdGraph*> containing function graphs.
- \`UBlueprint::UbergraphPages\` - TArray<UEdGraph*> containing event graphs.
- \`UBlueprint::DelegateSignatureGraphs\` - Graphs for delegate signatures.
- \`UBlueprint::MacroGraphs\` - Graphs for macros.
- \`UBlueprint::BlueprintType\` - EBlueprintType (Normal, Const, MacroLibrary, Interface, LevelScript, FunctionLibrary).

### UEdGraph
The graph container holding nodes. Each function or event graph is a UEdGraph.
- \`UEdGraph::Nodes\` - TArray<UEdGraphNode*>.
- \`UEdGraph::Schema\` - The UEdGraphSchema (UEdGraphSchema_K2 for Blueprints).
- \`UEdGraph::GetFName()\` - The graph name.

### UEdGraphNode
Base class for all graph nodes.
- \`UEdGraphNode::Pins\` - TArray<UEdGraphPin*>.
- \`UEdGraphNode::NodePosX\`, \`NodePosY\` - Position in the graph editor.
- \`UEdGraphNode::NodeComment\` - User comment.
- \`UEdGraphNode::GetNodeTitle()\` - Returns display title.
- \`UEdGraphNode::AllocateDefaultPins()\` - Creates the node's pins.
- \`UEdGraphNode::ReconstructNode()\` - Rebuilds pins (used after schema changes).
- \`UEdGraphNode::GetGraph()\` - Returns owning UEdGraph.

### UEdGraphPin
Represents a pin on a node for data or execution flow.
- \`UEdGraphPin::PinName\` - FName identifier.
- \`UEdGraphPin::PinType\` - FEdGraphPinType describing the data type.
- \`UEdGraphPin::Direction\` - EGPD_Input or EGPD_Output.
- \`UEdGraphPin::LinkedTo\` - TArray<UEdGraphPin*> of connected pins.
- \`UEdGraphPin::DefaultValue\` - String representation of the default value.
- \`UEdGraphPin::DefaultObject\` - UObject* default (for object references).
- \`UEdGraphPin::MakeLinkTo(UEdGraphPin* Other)\` - Creates a wire connection.
- \`UEdGraphPin::BreakLinkTo(UEdGraphPin* Other)\` - Removes a wire connection.
- \`UEdGraphPin::BreakAllPinLinks()\` - Disconnects all wires.

### FEdGraphPinType
Describes the type of a pin.
- \`PinCategory\` - FName: "bool", "int", "int64", "float", "double", "real", "name", "string", "text", "struct", "object", "class", "softobject", "softclass", "interface", "exec", "delegate", "mcdelegate", "byte", "enum", "wildcard".
- \`PinSubCategory\` - Additional type info (e.g., struct name).
- \`PinSubCategoryObject\` - UObject* for struct/class/enum types (e.g., the UScriptStruct*).
- \`ContainerType\` - EPinContainerType::None, Array, Set, Map.
- \`bIsReference\` - Pass by reference.
- \`bIsConst\` - Const reference.

## Key K2Node Types (UK2Node subclasses)

### Execution Flow
- \`UK2Node_Event\` - Event node (BeginPlay, Tick, custom events). EventReference points to the UFunction.
- \`UK2Node_CustomEvent\` - User-defined custom event.
- \`UK2Node_FunctionEntry\` / \`UK2Node_FunctionResult\` - Entry/exit points of a function graph.
- \`UK2Node_IfThenElse\` - Branch node. Pins: "Condition" (bool input), "Then" (exec), "Else" (exec).
- \`UK2Node_ExecutionSequence\` - Sequence node. Multiple "Then" exec outputs.
- \`UK2Node_Select\` - Select node for conditional value.

### Function Calls
- \`UK2Node_CallFunction\` - Calls a UFunction. FunctionReference identifies target. Set via \`SetFromFunction(UFunction*)\`.
- \`UK2Node_CallArrayFunction\` - Array operations.
- \`UK2Node_CallParentFunction\` - Super:: call.
- \`UK2Node_CallDataTableFunction\` - Data table row lookups.

### Variables
- \`UK2Node_VariableGet\` - Reads a variable. VariableReference is FMemberReference.
- \`UK2Node_VariableSet\` - Writes a variable.
- \`UK2Node_StructMemberGet\` / \`UK2Node_StructMemberSet\` - Break/make struct member access.
- \`UK2Node_TemporaryVariable\` - Local variable within a function.

### Casts & Conversions
- \`UK2Node_DynamicCast\` - Cast node. TargetType is the UClass* to cast to.
- \`UK2Node_ClassDynamicCast\` - Class reference cast.

### Macros & Composites
- \`UK2Node_MacroInstance\` - Instance of a macro graph.
- \`UK2Node_Composite\` - Collapsed graph.
- \`UK2Node_Tunnel\` - Entry/exit of a composite or macro.

### Creation & Destruction
- \`UK2Node_SpawnActorFromClass\` - SpawnActor node.
- \`UK2Node_ConstructObjectFromClass\` - NewObject equivalent.

### Math & Utility
- \`UK2Node_MakeArray\` - Constructs an array literal.
- \`UK2Node_MakeStruct\` / \`UK2Node_BreakStruct\` - Struct composition/decomposition.
- \`UK2Node_MakeMap\` / \`UK2Node_MakeSet\` - Container literals.
- \`UK2Node_CommutativeAssociativeBinaryOperator\` - Math operations (+, *, etc.).

### Flow Control
- \`UK2Node_ForEachElementInArray\` - For-each loop.
- \`UK2Node_ForEachElementInEnum\` - Enum iteration.
- \`UK2Node_WhileLoop\` - While loop.
- \`UK2Node_DoOnceMultiInput\` - Do-once with multiple inputs.
- \`UK2Node_MultiGate\` - Multi-gate sequencer.
- \`UK2Node_SwitchInteger\` / \`UK2Node_SwitchString\` / \`UK2Node_SwitchName\` / \`UK2Node_SwitchEnum\` - Switch statements.

## FBlueprintEditorUtils (Key Static Methods)

\`\`\`cpp
// Add a new function graph
UEdGraph* FBlueprintEditorUtils::CreateNewGraph(
    UObject* ParentScope,
    FName GraphName,
    TSubclassOf<UEdGraph> GraphClass,
    TSubclassOf<UEdGraphSchema> SchemaClass
);

// Add graph to Blueprint
void FBlueprintEditorUtils::AddFunctionGraph(
    UBlueprint* Blueprint,
    UEdGraph* Graph,
    bool bIsUserCreated
);

// Remove a function graph
void FBlueprintEditorUtils::RemoveFunctionGraph(
    UBlueprint* Blueprint,
    UEdGraph* Graph
);

// Add a member variable
bool FBlueprintEditorUtils::AddMemberVariable(
    UBlueprint* Blueprint,
    const FName& NewVarName,
    const FEdGraphPinType& NewVarType,
    const FString& DefaultValue = FString()
);

// Remove a member variable
void FBlueprintEditorUtils::RemoveMemberVariable(
    UBlueprint* Blueprint,
    const FName VarName
);

// Find a variable description by name
FBPVariableDescription* FBlueprintEditorUtils::FindNewVariableDescription(
    UBlueprint* Blueprint,
    const FName VarName
);

// Set variable category
void FBlueprintEditorUtils::SetBlueprintVariableCategory(
    UBlueprint* Blueprint,
    const FName VarName,
    const UStruct* InLocalVarScope,
    const FText& Category
);

// Set variable replication flags
void FBlueprintEditorUtils::SetBlueprintVariableRepNotifyFunc(
    UBlueprint* Blueprint,
    const FName VarName,
    const FName RepNotifyFunc
);

// Mark Blueprint as structurally modified (triggers recompile)
void FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(UBlueprint* Blueprint);

// Mark as modified (less severe, values changed)
void FBlueprintEditorUtils::MarkBlueprintAsModified(UBlueprint* Blueprint);

// Find event node for a given function
UK2Node_Event* FBlueprintEditorUtils::FindOverrideForFunction(
    const UBlueprint* Blueprint,
    const UClass* SignatureClass,
    FName SignatureName
);

// Add a component to the Blueprint's SimpleConstructionScript
USCS_Node* FBlueprintEditorUtils::AddComponentToBlueprint(
    UBlueprint* Blueprint,
    UActorComponent* ComponentTemplate
);

// Add an interface to the Blueprint
bool FBlueprintEditorUtils::ImplementNewInterface(
    UBlueprint* Blueprint,
    const FName& InterfaceClassName
);
\`\`\`

## Blueprint Compilation

### FKismetCompilerContext
- Drives compilation of a UBlueprint into a UBlueprintGeneratedClass.
- Converts UEdGraph nodes into bytecode (FKismetFunctionContext per function graph).
- Called via \`FKismetEditorUtilities::CompileBlueprint(Blueprint)\`.

### Compilation Flow
1. \`FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint)\` - Flags for recompile.
2. \`FKismetEditorUtilities::CompileBlueprint(Blueprint, EBlueprintCompileOptions::None)\` - Triggers compile.
3. \`Blueprint->Status\` becomes \`BS_UpToDate\` or \`BS_Error\`.
4. \`Blueprint->CompilerResultsLog\` contains any warnings/errors.

### Programmatic Compilation
\`\`\`cpp
FKismetEditorUtilities::CompileBlueprint(
    Blueprint,
    EBlueprintCompileOptions::SkipGarbageCollection
);
// Check results:
if (Blueprint->Status == BS_Error) {
    // Handle compilation errors
}
\`\`\`

## UE 5.7 Blueprint Changes
- Improved Blueprint nativization through Verse interop bridge.
- UEdGraphPin now stores SubPins for split struct pins more efficiently.
- FBlueprintEditorUtils::AddMemberVariable has an additional overload accepting FProperty metadata.
- UK2Node_CallFunction performance: node validation is deferred until compile in 5.7 for editor responsiveness.
- New UK2Node_FormatText supports ICU message format patterns.
- Blueprint Debugger improvements: conditional breakpoints via UBreakpoint::Condition.

## Common Patterns

### Creating a Function Graph with Nodes
\`\`\`cpp
// 1. Create the graph
UEdGraph* NewGraph = FBlueprintEditorUtils::CreateNewGraph(
    Blueprint,
    FName("MyFunction"),
    UEdGraph::StaticClass(),
    UEdGraphSchema_K2::StaticClass()
);

// 2. Add to Blueprint
FBlueprintEditorUtils::AddFunctionGraph(Blueprint, NewGraph, true);

// 3. The entry node is auto-created. Find it:
UK2Node_FunctionEntry* EntryNode = nullptr;
for (UEdGraphNode* Node : NewGraph->Nodes) {
    EntryNode = Cast<UK2Node_FunctionEntry>(Node);
    if (EntryNode) break;
}

// 4. Add a return node
UK2Node_FunctionResult* ResultNode = NewObject<UK2Node_FunctionResult>(NewGraph);
ResultNode->NodePosX = 400;
ResultNode->NodePosY = 0;
NewGraph->AddNode(ResultNode, false, false);
ResultNode->AllocateDefaultPins();

// 5. Connect entry "then" to result "execute"
UEdGraphPin* EntryThen = EntryNode->FindPin(UEdGraphSchema_K2::PN_Then);
UEdGraphPin* ResultExec = ResultNode->FindPin(UEdGraphSchema_K2::PN_Execute);
EntryThen->MakeLinkTo(ResultExec);

// 6. Compile
FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
\`\`\`

### Adding a Variable
\`\`\`cpp
FEdGraphPinType FloatType;
FloatType.PinCategory = UEdGraphSchema_K2::PC_Float;

FBlueprintEditorUtils::AddMemberVariable(
    Blueprint,
    FName("Health"),
    FloatType,
    TEXT("100.0")
);
\`\`\`

### Connecting Two Nodes
\`\`\`cpp
UEdGraphPin* OutputPin = SourceNode->FindPin(TEXT("ReturnValue"));
UEdGraphPin* InputPin = TargetNode->FindPin(TEXT("Value"));

if (OutputPin && InputPin) {
    const UEdGraphSchema* Schema = SourceNode->GetGraph()->GetSchema();
    Schema->TryCreateConnection(OutputPin, InputPin);
}
\`\`\`
`;
