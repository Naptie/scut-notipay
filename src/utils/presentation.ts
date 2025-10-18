import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration } from 'chart.js';

export interface ChartData {
  timestamp: string;
  electric: number;
  water: number;
  ac: number;
}

/**
 * Generate a PNG chart image for billing data
 */
export const generateBillingChart = async (
  data: ChartData[],
  room: string
): Promise<Buffer | null> => {
  if (data.length < 2) {
    return null;
  }

  // Sort data by timestamp
  const sorted = [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Format labels (show date and time for hourly data)
  const labels = sorted.map((d) => {
    const date = new Date(d.timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  const electricData = sorted.map((d) => d.electric);
  const waterData = sorted.map((d) => d.water);
  const acData = sorted.map((d) => d.ac);

  // Create chart configuration
  const configuration: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '电费 (¥)',
          data: electricData,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.1)',
          borderWidth: 2,
          tension: 0,
          fill: true
        },
        {
          label: '水费 (¥)',
          data: waterData,
          borderColor: 'rgb(54, 162, 235)',
          backgroundColor: 'rgba(54, 162, 235, 0.1)',
          borderWidth: 2,
          tension: 0,
          fill: true
        },
        {
          label: '空调费 (¥)',
          data: acData,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.1)',
          borderWidth: 2,
          tension: 0,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `${room} 账单`,
          font: {
            size: 18,
            weight: 'bold'
          }
        },
        legend: {
          display: true,
          position: 'top'
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: '余额 (¥)'
          }
        },
        x: {
          title: {
            display: true,
            text: '时间'
          },
          ticks: {
            maxRotation: 90,
            minRotation: 45
          }
        }
      }
    },
    plugins: [
      {
        id: 'customCanvasBackgroundColor',
        beforeDraw: (chart) => {
          const { ctx } = chart;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, chart.width, chart.height);
          ctx.restore();
        }
      }
    ]
  };

  // Create chart instance
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: 1200,
    height: 600,
    backgroundColour: 'white'
  });

  try {
    return await chartJSNodeCanvas.renderToBuffer(configuration);
  } catch (error) {
    console.error('Failed to generate chart:', error);
    return null;
  }
};

/**
 * Generate billing summary with current values and 24h changes
 */
export const generateBillingSummary = (
  current: { electric: number; water: number; ac: number },
  change24h?: { electric: number; water: number; ac: number } | null
): string => {
  let output = '📊 当前余额\n';
  output += '─'.repeat(15) + '\n';
  output += `⚡ 电费：\t${current.electric.toFixed(2)} 元\n`;
  output += `💧 水费：\t${current.water.toFixed(2)} 元\n`;
  output += `❄️ 空调费：\t${current.ac.toFixed(2)} 元\n`;

  if (change24h) {
    output += '\n📈 最近 24 小时\n';
    output += '─'.repeat(15) + '\n';
    output += `⚡ 电费：\t${change24h.electric > 0 ? '+' : ''}${change24h.electric.toFixed(2)} 元\n`;
    output += `💧 水费：\t${change24h.water > 0 ? '+' : ''}${change24h.water.toFixed(2)} 元\n`;
    output += `❄️ 空调费：\t${change24h.ac > 0 ? '+' : ''}${change24h.ac.toFixed(2)} 元\n\n`;
  }

  return output;
};
