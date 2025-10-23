import customtkinter as ctk
import webbrowser

class JobListItem(ctk.CTkFrame):
    def __init__(self, master, job, on_toggle_ready):
        super().__init__(master)
        
        self.job = job
        self.on_toggle_ready = on_toggle_ready
        self.is_selected = ctk.BooleanVar()

        self.grid_columnconfigure(2, weight=1)

        # --- Checkbox ---
        can_be_selected = job.get('status') == 'completed' and job.get('preview_url')
        if can_be_selected:
            self.checkbox = ctk.CTkCheckBox(self, text="", variable=self.is_selected, command=self._on_checkbox_toggle)
            self.checkbox.grid(row=0, rowspan=2, column=0, padx=10, pady=10)

        # --- Status Indicator ---
        self.status_indicator = ctk.CTkFrame(self, width=12, height=12, corner_radius=6)
        self.status_indicator.grid(row=0, rowspan=2, column=1, padx=(0, 10), pady=10)
        self.update_status_color()

        # --- Details ---
        self.details_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.details_frame.grid(row=0, rowspan=2, column=2, padx=10, pady=10, sticky="ew")
        
        self.title_label = ctk.CTkLabel(self.details_frame, text=job.get('title', 'No Title'), anchor="w", font=ctk.CTkFont(weight="bold"))
        self.title_label.pack(fill="x")
        
        meta_text = f"{job.get('base_version')} • {job.get('created_at')}"
        self.meta_label = ctk.CTkLabel(self.details_frame, text=meta_text, anchor="w", text_color="gray")
        self.meta_label.pack(fill="x")

        # --- Actions/Links ---
        self.actions_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.actions_frame.grid(row=0, rowspan=2, column=3, padx=10, pady=10)

        if job.get('preview_url'):
            self.preview_link = ctk.CTkButton(self.actions_frame, text="View Preview", command=self._open_preview)
            self.preview_link.pack(side="left", padx=5)

        self.status_label = ctk.CTkLabel(self.actions_frame, text=job.get('status', 'unknown').upper())
        self.status_label.pack(side="left", padx=5)

    def _on_checkbox_toggle(self):
        self.on_toggle_ready(self.job['id'], self.is_selected.get())

    def _open_preview(self):
        webbrowser.open_new_tab(self.job['preview_url'])

    def update_status_color(self):
        status_colors = {
            'pending': '#f0ad4e',
            'active': '#337ab7',
            'completed': '#5cb85c',
            'failed': '#d9534f',
            'cancelled': '#777777'
        }
        color = status_colors.get(self.job.get('status', 'cancelled'), '#777777')
        self.status_indicator.configure(fg_color=color)
