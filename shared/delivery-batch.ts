export type DeliveryResult = { id:string; ok:boolean; message:string };
/** Each item is its own durable provider job. Stop only prevents starting the next item. */
export async function runDeliveryBatch<T extends {id:string}>(items:T[],execute:(item:T)=>Promise<string>,onResult:(result:DeliveryResult)=>void,shouldStop:()=>boolean=()=>false) {
  const results:DeliveryResult[]=[];
  for(const item of items){
    if(shouldStop())break;
    let result:DeliveryResult;
    try{result={id:item.id,ok:true,message:await execute(item)};}
    catch(error){result={id:item.id,ok:false,message:error instanceof Error?error.message:"Versand fehlgeschlagen"};}
    results.push(result);onResult(result);
  }
  return results;
}
