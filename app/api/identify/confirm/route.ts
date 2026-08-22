import { validateConfirmationPayload } from "../../../../lib/identification/validation.ts";
import type { ConfirmRequest, InventoryResult } from "../../../../lib/identification/types.ts";
type Result={scanId:string;inventory:InventoryResult[]};type Dependencies={confirm:(input:ConfirmRequest)=>Promise<Result>};
export async function handleConfirmRequest(request:Request,deps:Dependencies){try{return Response.json(await deps.confirm(validateConfirmationPayload(await request.json())))}catch(error){return Response.json({error:error instanceof Error?error.message:"Confirmation failed"},{status:400})}}
export async function POST(request:Request){const[{env},{confirmIdentification}]=await Promise.all([import("cloudflare:workers"),import("../../../../lib/identification/persistence.ts")]);return handleConfirmRequest(request,{confirm:(input)=>confirmIdentification(input,env.DB)})}
