export interface Selector {
  kind: "universal" | "class" | "id";
  value: string; // "*" for universal, class name, or node id
  specificity: number; // 0=universal, 1=class, 2=id
}

export interface Declaration {
  property: string;
  value: string;
}

export interface StylesheetRule {
  selector: Selector;
  declarations: Declaration[];
}
