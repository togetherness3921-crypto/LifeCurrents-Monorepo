import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import './App.css';

// Define the type for a single job
type Job = {
    id: string;
    created_at: string;
    title: string;
    status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
    base_version: string;
    pr_number: number | null;
    preview_url: string | null;
    ready_for_integration: boolean;
};

// Custom hook to fetch and subscribe to jobs
function useJobs() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fetch initial data
        const fetchJobs = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('jobs')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching jobs:', error);
            } else {
                setJobs(data as Job[]);
            }
            setLoading(false);
        };

        fetchJobs();

        // Subscribe to real-time changes
        const channel = supabase
            .channel('jobs')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'jobs' },
                (payload) => {
                    console.log('Change received!', payload);
                    setJobs((currentJobs) => {
                        const newJob = payload.new as Job;
                        if (payload.eventType === 'INSERT') {
                            return [newJob, ...currentJobs];
                        }
                        if (payload.eventType === 'UPDATE') {
                            return currentJobs.map((job) =>
                                job.id === newJob.id ? newJob : job
                            );
                        }
                        return currentJobs;
                    });
                }
            )
            .subscribe();

        // Cleanup subscription on component unmount
        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return { jobs, loading };
}

// Component to display a single job
function JobListItem({ job, onToggleReady, isSelected }: { job: Job, onToggleReady: (id: string) => void, isSelected: boolean }) {
    const canBeSelected = job.status === 'completed' && job.preview_url;

    return (
        <div className="job-list-item" data-selected={isSelected}>
            {canBeSelected && (
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleReady(job.id)}
                    className="job-checkbox"
                />
            )}
            <div className="job-status-indicator" data-status={job.status}></div>
            <div className="job-details">
                <div className="job-title">{job.title}</div>
                <div className="job-meta">
                    <span>{job.base_version}</span>
                    <span>&bull;</span>
                    <span>{new Date(job.created_at).toLocaleString()}</span>
                </div>
            </div>
            <div className="job-status">{job.status}</div>
        </div>
    );
}

// Component to display the list of jobs
function JobList({ jobs, loading }: { jobs: Job[], loading: boolean }) {
    const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleToggleReady = (id: string) => {
        setSelectedJobs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const handleMarkAsReady = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const { error: updateError } = await supabase
                .from('jobs')
                .update({ ready_for_integration: true })
                .in('id', Array.from(selectedJobs));

            if (updateError) {
                throw updateError;
            }
            // UI will update automatically via realtime subscription
            setSelectedJobs(new Set());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };


    if (loading) {
        return <div className="loading">Loading jobs...</div>;
    }

    if (jobs.length === 0) {
        return <div className="no-jobs">No jobs found.</div>;
  }

  return (
        <div className="job-list-container">
            <div className="job-list-header">
                <h2>Completed Jobs</h2>
                <button
                    onClick={handleMarkAsReady}
                    disabled={selectedJobs.size === 0 || isSubmitting}
                >
                    {isSubmitting ? 'Marking...' : `Mark ${selectedJobs.size} as Ready for Integration`}
                </button>
            </div>
            {error && <p className="error-message">{error}</p>}
            <div className="job-list">
                {jobs.map((job) => (
                    <JobListItem
                        key={job.id}
                        job={job}
                        onToggleReady={handleToggleReady}
                        isSelected={selectedJobs.has(job.id)}
                    />
                ))}
            </div>
        </div>
    );
}

// Component for the new job form
function NewJobForm() {
    const [title, setTitle] = useState('');
    const [prompt, setPrompt] = useState('');
    const [verification, setVerification] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
          e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        const verification_steps = verification.split('\n').filter(step => step.trim() !== '');

        // TODO: Replace with the actual worker URL from an env var
        const workerUrl = 'http://127.0.0.1:8787/api/dispatch-job';

        try {
            const response = await fetch(workerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, prompt, verification_steps: { steps: verification_steps } }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to dispatch job');
            }

            // Reset form on success
            setTitle('');
            setPrompt('');
            setVerification('');

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="new-job-form-container">
            <h2>Dispatch a New Job</h2>
            <form onSubmit={handleSubmit} className="new-job-form">
        <input
                    type="text"
                    placeholder="Job Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                />
                <textarea
                    placeholder="Development Prompt..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    required
                    rows={10}
                />
                <textarea
                    placeholder="Verification Steps (one per line)..."
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                    rows={5}
                />
                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Dispatching...' : 'Dispatch Job'}
                </button>
                {error && <p className="error-message">{error}</p>}
      </form>
        </div>
    );
}


// Main App component
function App() {
    const { jobs, loading } = useJobs();

    return (
        <div className="container">
            <header className="app-header">
                <h1>Job Dashboard</h1>
            </header>
            <main>
                <NewJobForm />
                <JobList jobs={jobs} loading={loading} />
    </main>
        </div>
  );
}

export default App;
