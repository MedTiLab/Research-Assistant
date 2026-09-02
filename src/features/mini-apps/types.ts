export interface MiniAppSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface MiniApp extends MiniAppSummary {
  html: string;
}
