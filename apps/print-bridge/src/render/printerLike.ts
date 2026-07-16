/** Sous-ensemble de l'API node-thermal-printer utilisé par les templates —
 *  permet de tester le rendu avec un enregistreur d'appels, sans imprimante. */
export interface PrinterLike {
  alignCenter(): void;
  alignLeft(): void;
  bold(on: boolean): void;
  setTextSize(height: number, width: number): void;
  setTextNormal(): void;
  println(text: string): void;
  newLine(): void;
  drawLine(): void;
  leftRight(left: string, right: string): void;
  cut(): void;
  /** Optionnel (présent sur ThermalPrinter) — QR du numéro de commande quand
   *  le template de reçu active show_qr. Les mocks sans QR restent valides. */
  printQR?(data: string): void;
}
