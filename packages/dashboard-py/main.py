import customtkinter as ctk
from supabase_client import SupabaseManager
from ui_components import JobListItem
import threading
import queue
import requests
import asyncio
import subprocess
import atexit
from collections import defaultdict
from typing import Optional

# --- Global process list to ensure cleanup ---
running_processes = []

def cleanup_processes():
    print("Cleaning up running subprocesses...")
    for p in running_processes:
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
    print("Subprocesses cleaned up.")

atexit.register(cleanup_processes)

class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.jobs = {}
        self.job_widgets = {}
        self.selected_jobs = set()
        
        self.queue: queue.Queue = queue.Queue()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.shutdown_event: Optional[asyncio.Event] = None
        self.async_thread: Optional[threading.Thread] = None
        
        self.title("LifeCurrents Job Dashboard")
        self.geometry("1200x900")

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.create_job_list()
        self.start_subprocesses()
        
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.start_async_loop()

    def start_subprocesses(self):
        print("Starting background services...")
        worker_command = "npm run dev --workspace=packages/worker -- --port 8787"
        worker_process = subprocess.Popen(worker_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='ignore')
        running_processes.append(worker_process)
        mcp_command = "node packages/mcp-server/build/index.js"
        mcp_process = subprocess.Popen(mcp_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='ignore')
        running_processes.append(mcp_process)
        threading.Thread(target=self.log_subprocess_output, args=(worker_process, "Worker"), daemon=True).start()
        threading.Thread(target=self.log_subprocess_output, args=(mcp_process, "MCP"), daemon=True).start()

    def log_subprocess_output(self, process, name):
        if process.stdout:
            for line in iter(process.stdout.readline, ''):
                print(f"[{name}] {line.strip()}")

    def create_job_list(self):
        self.list_container = ctk.CTkFrame(self)
        self.list_container.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        self.list_container.grid_columnconfigure(0, weight=1)
        self.list_container.grid_rowconfigure(1, weight=1)
        header_frame = ctk.CTkFrame(self.list_container)
        header_frame.grid(row=0, column=0, padx=10, pady=10, sticky="ew")
        header_frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(header_frame, text="Job Queue", font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w")
        self.reconciliation_button = ctk.CTkButton(header_frame, text="Mark 0 as Ready", command=self.mark_as_ready, state="disabled")
        self.reconciliation_button.grid(row=0, column=1, sticky="e")
        self.scrollable_frame = ctk.CTkScrollableFrame(self.list_container, fg_color="transparent")
        self.scrollable_frame.grid(row=1, column=0, padx=0, pady=(0, 10), sticky="nsew")
        self.scrollable_frame.grid_columnconfigure(0, weight=1)

    def start_async_loop(self):
        self.async_thread = threading.Thread(target=self._run_async_loop, daemon=True)
        self.async_thread.start()
        self.process_queue()

    def _run_async_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.shutdown_event = asyncio.Event()
        
        url = "https://cvzgxnspmmxxxwnxiydk.supabase.co"
        key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2emd4bnNwbW14eHh3bnhpeWRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4NzczNTgsImV4cCI6MjA3MjQ1MzM1OH0.2syXitu78TLVBu8hD7DfAC7h6CYvgyP-ZWcw9wY3xhU"
        self.supabase_manager = SupabaseManager(url, key)

        try:
            self.loop.run_until_complete(self.async_worker())
        finally:
            self.loop.close()

    async def async_worker(self):
        await self.supabase_manager.initialize()
        initial_jobs = await self.supabase_manager.fetch_initial_jobs()
        self.queue.put({'type': 'INITIAL', 'payload': initial_jobs})

        await self.supabase_manager.setup_realtime_subscription(
            lambda payload: self.queue.put({'type': 'REALTIME', 'payload': payload})
        )
        await self.shutdown_event.wait()
        await self.supabase_manager.cleanup()

    def process_queue(self):
        try:
            while True:
                message = self.queue.get_nowait()
                if message['type'] == 'INITIAL':
                    self.handle_initial_data(message['payload'])
                elif message['type'] == 'REALTIME':
                    self.handle_realtime_update(message['payload'])
        except queue.Empty:
            pass
        if self.winfo_exists():
            self.after(100, self.process_queue)

    def handle_initial_data(self, jobs):
        self.jobs = {job['id']: job for job in jobs}
        self.render_all_jobs()

    def handle_realtime_update(self, payload):
        event_type = payload.get('type')
        record = payload.get('record', {}) if event_type != 'DELETE' else payload.get('old_record', {})
        job_id = record.get('id')
        if not job_id: return
        
        if event_type == 'INSERT' or event_type == 'UPDATE':
            self.jobs[job_id] = record
        elif event_type == 'DELETE':
            if job_id in self.jobs: del self.jobs[job_id]
        
        self.render_all_jobs()
        
    def on_toggle_ready(self, job_id, is_selected):
        if is_selected: self.selected_jobs.add(job_id)
        else: self.selected_jobs.discard(job_id)
        count = len(self.selected_jobs)
        self.reconciliation_button.configure(text=f"Mark {count} as Ready", state="normal" if count > 0 else "disabled")
        
    def mark_as_ready(self):
        job_ids = list(self.selected_jobs)
        if not job_ids or not self.loop: return
        self.reconciliation_button.configure(state="disabled", text="Marking...")
        asyncio.run_coroutine_threadsafe(self.supabase_manager.mark_jobs_as_ready(job_ids), self.loop)
        self.selected_jobs.clear()
        self.after(1000, lambda: self.reconciliation_button.configure(text="Mark 0 as Ready", state="disabled"))

    def delete_job(self, job_id):
        if job_id in self.jobs:
            del self.jobs[job_id]
            self.render_all_jobs()
        if self.loop:
            asyncio.run_coroutine_threadsafe(self.supabase_manager.delete_job(job_id), self.loop)

    def render_all_jobs(self):
        for child in self.scrollable_frame.winfo_children(): child.destroy()
        self.job_widgets = {}
        grouped_jobs = defaultdict(list)
        for job in self.jobs.values(): grouped_jobs[job.get('base_version', 'Unknown')].append(job)
        sorted_groups = sorted(grouped_jobs.items(), key=lambda item: max(j['created_at'] for j in item[1]), reverse=True)
        for i, (base_version, jobs_in_group) in enumerate(sorted_groups):
            group_frame = ctk.CTkFrame(self.scrollable_frame)
            group_frame.grid(row=i, column=0, padx=10, pady=(10, 5), sticky="ew")
            group_frame.grid_columnconfigure(0, weight=1)
            header = ctk.CTkLabel(group_frame, text=f"Base Version: {base_version}", font=ctk.CTkFont(weight="bold"))
            header.pack(fill="x", padx=10, pady=5)
            sorted_jobs = sorted(jobs_in_group, key=lambda j: j['created_at'], reverse=True)
            for job in sorted_jobs:
                job_id = job['id']
                job_widget = JobListItem(group_frame, job, on_toggle_ready=self.on_toggle_ready, on_delete=self.delete_job)
                job_widget.pack(fill="x", padx=10, pady=5)
                self.job_widgets[job_id] = job_widget
    
    def on_closing(self):
        print("Initiating graceful shutdown...")
        if self.shutdown_event and self.loop:
            self.loop.call_soon_threadsafe(self.shutdown_event.set)
        
        if self.async_thread and self.async_thread.is_alive():
            self.async_thread.join(timeout=2.0)
            
        cleanup_processes()
        self.destroy()
        print("Shutdown complete.")

if __name__ == "__main__":
    app = App()
    app.mainloop()
