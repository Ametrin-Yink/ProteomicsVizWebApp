export {};

declare global {
  interface Window {
    __setDiaMetadata?: (data: Record<string, Record<string, string>>) => void;
    __updateTmtMapping?: (
      filename: string,
      channel: string,
      groups: Record<string, string | number>
    ) => void;
  }
}
