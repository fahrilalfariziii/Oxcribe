import "dotenv/config";
import { validateRuntimeConfig } from "./lib/config";

validateRuntimeConfig(process.env);
