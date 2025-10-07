import { useEffect, useRef } from 'react';

const LavaLampBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    let animationFrameId;
    let blobs = [];

    // Set canvas size (use lower resolution for better performance)
    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio, 1.5); // Limit DPR for performance
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize blobs with Uppsala colors (fewer blobs for better performance)
    const colors = [
      { r: 32, g: 46, b: 69 },     // Uppsala blue #202e45
      { r: 252, g: 211, b: 77 },   // Yellow
      { r: 23, g: 34, b: 52 },     // Darker Uppsala blue
      { r: 100, g: 130, b: 180 },  // Light blue
      { r: 200, g: 215, b: 240 },  // Very light blue
    ];

    // Reduce to 8 blobs for better performance
    for (let i = 0; i < 8; i++) {
      const color = colors[i % colors.length];
      blobs.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        radius: 120 + Math.random() * 180,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        color: `rgba(${color.r}, ${color.g}, ${color.b}, 0.35)`,
        phase: Math.random() * Math.PI * 2,
      });
    }

    let lastTime = 0;
    const targetFPS = 60;
    const frameInterval = 1000 / targetFPS;

    // Animation loop with FPS throttling
    const animate = (time) => {
      animationFrameId = requestAnimationFrame(animate);

      // Throttle to target FPS
      const deltaTime = time - lastTime;
      if (deltaTime < frameInterval) return;
      lastTime = time - (deltaTime % frameInterval);

      // Clear with background color
      ctx.fillStyle = '#F3F4F6';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      // Update and draw blobs
      blobs.forEach((blob) => {
        // Smooth organic movement
        blob.x += blob.vx + Math.sin(time * 0.0005 + blob.phase) * 0.3;
        blob.y += blob.vy + Math.cos(time * 0.0004 + blob.phase) * 0.3;

        // Wrap around edges
        if (blob.x < -blob.radius) blob.x = window.innerWidth + blob.radius;
        if (blob.x > window.innerWidth + blob.radius) blob.x = -blob.radius;
        if (blob.y < -blob.radius) blob.y = window.innerHeight + blob.radius;
        if (blob.y > window.innerHeight + blob.radius) blob.y = -blob.radius;

        // Draw blob with gradient (simpler gradient for performance)
        const gradient = ctx.createRadialGradient(
          blob.x, blob.y, 0,
          blob.x, blob.y, blob.radius
        );
        gradient.addColorStop(0, blob.color);
        gradient.addColorStop(0.7, blob.color.replace(/[\d.]+\)$/g, '0.1)'));
        gradient.addColorStop(1, blob.color.replace(/[\d.]+\)$/g, '0)'));

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
        filter: 'blur(40px)',
        transform: 'scale(1.1)', // Slightly scale up to hide blur edges
      }}
    />
  );
};

export default LavaLampBackground;
