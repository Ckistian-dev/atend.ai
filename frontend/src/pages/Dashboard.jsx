// src/pages/Dashboard.jsx

import React from 'react';
import { Wrench } from 'lucide-react';

// --- COMPONENTE PRINCIPAL DO DASHBOARD ---
const Dashboard = () => {
    return (
        <div className="flex h-full items-center justify-center bg-gray-50 p-6">
            <div className="text-center">
                <Wrench className="mx-auto h-16 w-16 text-gray-400" />
                <h2 className="mt-4 text-2xl font-bold text-gray-700">Em desenvolvimento</h2>
                <p className="mt-2 text-gray-500">
                    Esta página está sendo construída e estará disponível em breve.
                </p>
            </div>
        </div>
    );
};

export default Dashboard;