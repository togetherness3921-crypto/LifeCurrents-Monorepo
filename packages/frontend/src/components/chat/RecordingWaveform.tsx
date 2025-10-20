import { useEffect, useRef } from 'react';

interface RecordingWaveformProps {
    analyser: AnalyserNode | null;
    isActive: boolean;
}

const RecordingWaveform: React.FC<RecordingWaveformProps> = ({ analyser, isActive }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;

        let animationId: number;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resize();
        window.addEventListener('resize', resize);

        const draw = () => {
            const width = canvas.width / (window.devicePixelRatio || 1);
            const height = canvas.height / (window.devicePixelRatio || 1);
            context.clearRect(0, 0, width, height);

            const color = getComputedStyle(canvas).color || 'hsl(var(--primary))';
            context.strokeStyle = color;
            context.lineWidth = 2;

            const bufferLength = analyser ? analyser.fftSize : 1024;
            const dataArray = new Uint8Array(bufferLength);
            if (analyser && isActive) {
                analyser.getByteTimeDomainData(dataArray);
            } else {
                dataArray.fill(128);
            }

            const sliceWidth = width / dataArray.length;
            let x = 0;

            context.beginPath();

            for (let i = 0; i < dataArray.length; i++) {
                const value = dataArray[i] / 128.0;
                const y = (value * height) / 2;
                if (i === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
                x += sliceWidth;
            }

            context.stroke();
            animationId = window.requestAnimationFrame(draw);
        };

        draw();

        return () => {
            window.cancelAnimationFrame(animationId);
            window.removeEventListener('resize', resize);
        };
    }, [analyser, isActive]);

    return <canvas ref={canvasRef} className="h-10 w-full text-primary" />;
};

export default RecordingWaveform;

