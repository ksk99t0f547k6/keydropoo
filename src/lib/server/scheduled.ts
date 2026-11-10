// 排程工作逐一執行並各自隔離錯誤：一個工作失敗（設定錯誤、外部服務或 D1 暫時錯誤）
// 不能讓後面的訂單到期、寄碼、Webhook 與外部撤銷一起停擺。
export interface ScheduledTask {
  name: string;
  run: () => Promise<unknown>;
}

export async function runScheduledTasks(tasks: ScheduledTask[], log: (message: string) => void = console.error) {
  const failed: string[] = [];
  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      failed.push(task.name);
      // 只記錄工作名稱與錯誤類型／訊息，不輸出可能含碼或機密的物件內容。
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      log(`[keydrop] scheduled task ${task.name} failed: ${detail.slice(0, 300)}`);
    }
  }
  // 全部跑完後再拋錯，讓 Cloudflare 把這次排程標為失敗，方便在儀表板發現。
  if (failed.length) throw new Error(`SCHEDULED_TASKS_FAILED: ${failed.join(",")}`);
}
