#!/usr/bin/env python3
"""
LSTM Regime Forecasting (Phase 5.2)

Deep learning approach to PXI regime prediction using LSTM neural networks.
Trains on historical PXI time series and generates multi-day forecasts.

Usage:
    python3 ml/lstm_predictor.py --horizon=7 --days=365 --retrain
    python3 ml/lstm_predictor.py --horizon=14 --load-model
"""

import argparse
import json
import sys
import os
from datetime import datetime
from typing import List, Dict, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import psycopg2
from psycopg2.extras import RealDictCursor


# ============================================================================
# Configuration
# ============================================================================

class Config:
    """Model and training configuration"""
    # Database
    DB_URL = os.environ.get(
        'DATABASE_URL',
        'postgresql://pxi:pxi123@localhost:5432/pxi'
    )

    # Model architecture
    SEQUENCE_LENGTH = 10  # Days of history for input
    HIDDEN_SIZE = 64      # LSTM hidden units
    NUM_LAYERS = 2        # Stacked LSTM layers
    DROPOUT = 0.2         # Dropout rate

    # Training
    BATCH_SIZE = 16
    EPOCHS = 100
    LEARNING_RATE = 0.001
    TRAIN_SPLIT = 0.8     # 80% train, 20% validation

    # Paths
    MODEL_DIR = 'ml/models'
    MODEL_PATH = 'ml/models/lstm_pxi_predictor.pt'
    SCALER_PATH = 'ml/models/scaler_params.json'

    # Device
    DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


# ============================================================================
# Data Management
# ============================================================================

def fetch_historical_pxi(days: int = 365) -> np.ndarray:
    """Fetch historical PXI values from database"""
    try:
        conn = psycopg2.connect(Config.DB_URL)
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT DISTINCT ON (DATE(timestamp))
                pxi_value
            FROM composite_pxi_regime
            WHERE timestamp >= NOW() - INTERVAL '%s days'
            ORDER BY DATE(timestamp) ASC, timestamp DESC
        """

        cursor.execute(query, (days,))
        rows = cursor.fetchall()

        pxi_values = np.array([float(row['pxi_value']) for row in rows])

        cursor.close()
        conn.close()

        print(f"Fetched {len(pxi_values)} PXI data points", file=sys.stderr)
        return pxi_values

    except Exception as e:
        print(f"Database error: {e}", file=sys.stderr)
        sys.exit(1)


class MinMaxScaler:
    """Simple min-max scaler for normalization"""
    def __init__(self):
        self.min = None
        self.max = None

    def fit(self, data: np.ndarray):
        """Fit scaler to data"""
        self.min = data.min()
        self.max = data.max()

    def transform(self, data: np.ndarray) -> np.ndarray:
        """Transform data to [-1, 1] range"""
        return 2 * (data - self.min) / (self.max - self.min + 1e-8) - 1

    def inverse_transform(self, data: np.ndarray) -> np.ndarray:
        """Inverse transform from [-1, 1] to original range"""
        return (data + 1) * (self.max - self.min + 1e-8) / 2 + self.min

    def save(self, path: str):
        """Save scaler parameters"""
        params = {'min': float(self.min), 'max': float(self.max)}
        with open(path, 'w') as f:
            json.dump(params, f)

    def load(self, path: str):
        """Load scaler parameters"""
        with open(path, 'r') as f:
            params = json.load(f)
        self.min = params['min']
        self.max = params['max']


class PXIDataset(Dataset):
    """PyTorch dataset for PXI time series"""
    def __init__(self, sequences: np.ndarray, targets: np.ndarray):
        self.sequences = torch.FloatTensor(sequences)
        self.targets = torch.FloatTensor(targets)

    def __len__(self):
        return len(self.sequences)

    def __getitem__(self, idx):
        return self.sequences[idx], self.targets[idx]


def create_sequences(data: np.ndarray, seq_length: int) -> Tuple[np.ndarray, np.ndarray]:
    """Create sequences for LSTM training"""
    sequences = []
    targets = []

    for i in range(len(data) - seq_length):
        seq = data[i:i + seq_length]
        target = data[i + seq_length]
        sequences.append(seq)
        targets.append(target)

    return np.array(sequences), np.array(targets)


# ============================================================================
# LSTM Model
# ============================================================================

class LSTMPredictor(nn.Module):
    """LSTM model for PXI forecasting"""
    def __init__(self, input_size=1, hidden_size=64, num_layers=2, dropout=0.2):
        super(LSTMPredictor, self).__init__()

        self.hidden_size = hidden_size
        self.num_layers = num_layers

        # LSTM layers
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0,
            batch_first=True
        )

        # Fully connected output layer
        self.fc = nn.Linear(hidden_size, 1)

    def forward(self, x):
        # x shape: (batch, seq_length, input_size)
        lstm_out, _ = self.lstm(x)

        # Use the last timestep output
        last_output = lstm_out[:, -1, :]

        # Predict next value
        prediction = self.fc(last_output)

        return prediction


# ============================================================================
# Training
# ============================================================================

def train_model(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    epochs: int = 100,
    learning_rate: float = 0.001
) -> Dict[str, List[float]]:
    """Train LSTM model"""
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    history = {'train_loss': [], 'val_loss': []}
    best_val_loss = float('inf')

    print(f"\nTraining on {Config.DEVICE}...", file=sys.stderr)

    for epoch in range(epochs):
        # Training phase
        model.train()
        train_losses = []

        for sequences, targets in train_loader:
            sequences = sequences.unsqueeze(-1).to(Config.DEVICE)
            targets = targets.unsqueeze(-1).to(Config.DEVICE)

            optimizer.zero_grad()
            outputs = model(sequences)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            train_losses.append(loss.item())

        avg_train_loss = np.mean(train_losses)
        history['train_loss'].append(avg_train_loss)

        # Validation phase
        model.eval()
        val_losses = []

        with torch.no_grad():
            for sequences, targets in val_loader:
                sequences = sequences.unsqueeze(-1).to(Config.DEVICE)
                targets = targets.unsqueeze(-1).to(Config.DEVICE)

                outputs = model(sequences)
                loss = criterion(outputs, targets)
                val_losses.append(loss.item())

        avg_val_loss = np.mean(val_losses)
        history['val_loss'].append(avg_val_loss)

        # Save best model
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), Config.MODEL_PATH)

        # Log progress every 10 epochs
        if (epoch + 1) % 10 == 0:
            print(
                f"Epoch {epoch + 1}/{epochs}: "
                f"Train Loss={avg_train_loss:.6f}, "
                f"Val Loss={avg_val_loss:.6f}",
                file=sys.stderr
            )

    print(f"\nBest validation loss: {best_val_loss:.6f}", file=sys.stderr)
    return history


# ============================================================================
# Prediction
# ============================================================================

def derive_regime(pxi: float) -> str:
    """Map PXI value to regime category"""
    if pxi > 2.0:
        return 'Strong PAMP'
    elif pxi > 1.0:
        return 'Moderate PAMP'
    elif pxi >= -1.0:
        return 'Normal'
    elif pxi >= -2.0:
        return 'Elevated Stress'
    else:
        return 'Crisis'


def predict_future(
    model: nn.Module,
    scaler: MinMaxScaler,
    initial_sequence: np.ndarray,
    horizon: int
) -> List[Dict]:
    """Generate multi-day forecast"""
    model.eval()

    # Prepare initial sequence
    current_seq = scaler.transform(initial_sequence.copy())
    forecasts = []

    with torch.no_grad():
        for day in range(1, horizon + 1):
            # Prepare input (batch_size=1, seq_length, features=1)
            input_seq = torch.FloatTensor(current_seq[-Config.SEQUENCE_LENGTH:])
            input_seq = input_seq.unsqueeze(0).unsqueeze(-1).to(Config.DEVICE)

            # Predict next value
            pred_scaled = model(input_seq).item()

            # Inverse transform to get actual PXI
            pred_pxi = scaler.inverse_transform(np.array([pred_scaled]))[0]

            # Derive regime
            regime = derive_regime(pred_pxi)

            # Estimate confidence (simple heuristic: higher for shorter horizons)
            confidence = max(0.5, 0.95 - (day - 1) * 0.05)

            forecasts.append({
                'day': day,
                'predictedPxi': float(pred_pxi),
                'predictedRegime': regime,
                'confidence': confidence
            })

            # Update sequence with prediction for next iteration
            current_seq = np.append(current_seq, pred_scaled)

    return forecasts


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='LSTM PXI Regime Forecasting')
    parser.add_argument('--horizon', type=int, default=7, help='Forecast horizon (days)')
    parser.add_argument('--days', type=int, default=365, help='Historical days for training')
    parser.add_argument('--retrain', action='store_true', help='Retrain model from scratch')
    parser.add_argument('--epochs', type=int, default=100, help='Training epochs')
    args = parser.parse_args()

    # Ensure model directory exists
    os.makedirs(Config.MODEL_DIR, exist_ok=True)

    # Fetch historical data
    historical_pxi = fetch_historical_pxi(args.days)

    if len(historical_pxi) < Config.SEQUENCE_LENGTH + 10:
        print(f"Error: Insufficient data ({len(historical_pxi)} points)", file=sys.stderr)
        sys.exit(1)

    # Initialize scaler
    scaler = MinMaxScaler()
    scaler.fit(historical_pxi)

    # Check if we need to train
    need_training = args.retrain or not os.path.exists(Config.MODEL_PATH)

    if need_training:
        print("Training new model...", file=sys.stderr)

        # Prepare data
        scaled_data = scaler.transform(historical_pxi)
        sequences, targets = create_sequences(scaled_data, Config.SEQUENCE_LENGTH)

        # Train/val split
        split_idx = int(len(sequences) * Config.TRAIN_SPLIT)

        train_dataset = PXIDataset(sequences[:split_idx], targets[:split_idx])
        val_dataset = PXIDataset(sequences[split_idx:], targets[split_idx:])

        train_loader = DataLoader(train_dataset, batch_size=Config.BATCH_SIZE, shuffle=True)
        val_loader = DataLoader(val_dataset, batch_size=Config.BATCH_SIZE, shuffle=False)

        # Initialize model
        model = LSTMPredictor(
            input_size=1,
            hidden_size=Config.HIDDEN_SIZE,
            num_layers=Config.NUM_LAYERS,
            dropout=Config.DROPOUT
        ).to(Config.DEVICE)

        # Train
        history = train_model(model, train_loader, val_loader, epochs=args.epochs)

        # Save scaler
        scaler.save(Config.SCALER_PATH)

        print(f"Model saved to {Config.MODEL_PATH}", file=sys.stderr)
    else:
        print("Loading existing model...", file=sys.stderr)

        # Load model
        model = LSTMPredictor(
            input_size=1,
            hidden_size=Config.HIDDEN_SIZE,
            num_layers=Config.NUM_LAYERS,
            dropout=Config.DROPOUT
        ).to(Config.DEVICE)

        model.load_state_dict(torch.load(Config.MODEL_PATH, map_location=Config.DEVICE))

        # Load scaler
        scaler.load(Config.SCALER_PATH)

    # Generate forecasts
    print(f"Generating {args.horizon}-day forecast...", file=sys.stderr)

    initial_sequence = historical_pxi[-Config.SEQUENCE_LENGTH:]
    forecasts = predict_future(model, scaler, initial_sequence, args.horizon)

    # Prepare output
    output = {
        'timestamp': datetime.now().isoformat(),
        'method': 'lstm',
        'model': {
            'hidden_size': Config.HIDDEN_SIZE,
            'num_layers': Config.NUM_LAYERS,
            'sequence_length': Config.SEQUENCE_LENGTH
        },
        'daysAnalyzed': len(historical_pxi),
        'horizon': args.horizon,
        'forecasts': forecasts,
        'summary': {
            'avgPredictedPxi': np.mean([f['predictedPxi'] for f in forecasts]),
            'avgConfidence': np.mean([f['confidence'] for f in forecasts]),
            'regimeDistribution': {}
        }
    }

    # Calculate regime distribution
    for forecast in forecasts:
        regime = forecast['predictedRegime']
        output['summary']['regimeDistribution'][regime] = \
            output['summary']['regimeDistribution'].get(regime, 0) + 1

    # Output JSON to stdout (TypeScript will parse this)
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
