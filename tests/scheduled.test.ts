import {describe,expect,it} from "vitest";
import {runScheduledTasks} from "../src/lib/server/scheduled";

describe("排程工作隔離",()=>{
  it("前一個工作失敗時，後面的工作照樣執行，最後彙整失敗名稱",async()=>{
    const ran:string[]=[];const logs:string[]=[];
    await expect(runScheduledTasks([
      {name:"first",run:async()=>{ran.push("first");throw new Error("bad EMAIL_FROM");}},
      {name:"second",run:async()=>{ran.push("second");}},
      {name:"third",run:async()=>{ran.push("third");throw "not an error";}},
      {name:"fourth",run:async()=>{ran.push("fourth");}},
    ],message=>logs.push(message))).rejects.toThrow("SCHEDULED_TASKS_FAILED: first,third");
    expect(ran).toEqual(["first","second","third","fourth"]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("first failed: Error: bad EMAIL_FROM");
    expect(logs[1]).toContain("unknown error");
  });
  it("全部成功時不拋錯也不記錄",async()=>{
    const logs:string[]=[];
    await runScheduledTasks([{name:"a",run:async()=>1}],message=>logs.push(message));
    expect(logs).toEqual([]);
  });
});
