// Shape of every API response. Services return it, controllers send it with res.status(result.status).json(result).
export interface Result {
  status: number;
  message: string;
  data?: any;
  error?: string;
  context?: string;
}
