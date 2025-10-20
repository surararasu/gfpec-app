import React, { useState, useMemo, useEffect, useRef } from 'react';
// The 'jspdf' and 'jspdf-autotable' libraries are now loaded dynamically via a useEffect hook to prevent build errors.
import { FileDown, PlusCircle, Trash2, ArrowRight, ArrowLeft, Info, Loader, ShieldCheck, XCircle, User, Briefcase, Stethoscope, AlertTriangle } from 'lucide-react';

// Heimdall Inc. - A placeholder for a professional entity
const BrandHeader = () => (
    <div className="flex items-center justify-center space-x-2 text-gray-500">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        <span className="font-semibold text-lg">Heimdall Inc.</span>
    </div>
);

// --- Rounding Helper for Currency ---
const $ = (n) => Math.round((Number(n) || 0) * 100) / 100;

// --- Date Formatting Helper ---
const formatDate = (dateString) => {
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return 'N/A';
    }
    const [year, month, day] = dateString.split('-');
    // Handles timezone issue by creating date in UTC
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};


// --- MODIFIER LOGIC ---
const applyModifiers = (procedure) => {
    const originalAllowedAmount = Number(procedure.allowedAmount) || 0;
    let modifiedAllowedAmount = originalAllowedAmount;
    let modifierNote = null;
    const modifiers = procedure.modifiers ? procedure.modifiers.split(',').map(m => m.trim().toUpperCase()) : [];

    let noteParts = [];
    let factor = 1;
    if (modifiers.includes('50')) { factor *= 1.5; noteParts.push("+50% bilateral"); }
    if (modifiers.includes('62')) { factor *= 1.25; noteParts.push("+25% co-surgeons"); }
    // ... add other stacking modifiers here

    if (noteParts.length > 0) {
        modifiedAllowedAmount = $(originalAllowedAmount * factor);
        modifierNote = { description: "Pricing Modifiers Applied", patientOwes: 0.0, notes: `Factors: ${noteParts.join(', ')}.` };
    }

    return { modifiedAllowedAmount, modifierNote, originalAllowedAmount };
};

// --- Centralized Plan-Aware OOP Helper ---
const planAwareRemOop = (indOopMax, famOopMax, patientOopMet, familyOopMet, planType) => {
    const rInd = (indOopMax === '' || indOopMax == null) ? Infinity : Math.max(0, (Number(indOopMax) || 0) - (Number(patientOopMet) || 0));
    const rFam = (famOopMax === '' || famOopMax == null) ? Infinity : Math.max(0, (Number(famOopMax) || 0) - (Number(familyOopMet) || 0));
    if (planType === 'Individual') return rInd;
    if (planType === 'AggregateFamily') return rFam;
    return Math.min(rInd, rFam); // Embedded
};


// --- CORE CALCULATION LOGIC ---
// **ALGORITHM 11.0: Production Ready with Procedure Sorting**
const calculateEstimate = (benefits, patientAccumulators, familyAccumulators, procedures, metaData) => {
    // Sanitize inputs to ensure all accumulator values are numbers
    const sanitizeNumber = (val) => {
        const num = Number(val);
        if (isNaN(num)) return 0;
        return num < 0 ? 0 : num;
    };

    let currentPatientAcc = {
        deductibleMet: sanitizeNumber(patientAccumulators.deductibleMet),
        oopMet: sanitizeNumber(patientAccumulators.oopMet),
    };
    let currentFamilyAcc = familyAccumulators ? {
        deductibleMet: sanitizeNumber(familyAccumulators.deductibleMet),
        oopMet: sanitizeNumber(familyAccumulators.oopMet),
    } : null;

    const getRemaining = (limit, met) => {
        if (limit === null || limit === undefined || limit === '') return Infinity;
        const numLimit = Number(limit) || 0;
        const numMet = Number(met) || 0;
        if (numLimit === 0 && (limit?.toString().trim() === '0')) return 0;
        return Math.max(0, numLimit - numMet);
    };

    let procedureEstimates = [];
    let totalPatientResponsibility = 0.0;
    
    // --- Early Exit for Met OOP (Plan-aware) ---
    const remIndOop = getRemaining(benefits.individualOopMax, currentPatientAcc.oopMet);
    const remFamOop = currentFamilyAcc ? getRemaining(benefits.familyOopMax, currentFamilyAcc.oopMet) : Infinity;

    let oopMet = false, reason = '';
    if (benefits.planType === 'Individual') { oopMet = remIndOop <= 0; reason = 'Individual OOP Met'; }
    else if (benefits.planType === 'AggregateFamily') { oopMet = remFamOop <= 0; reason = 'Family OOP Met'; }
    else { oopMet = (remIndOop <= 0) || (remFamOop <= 0); reason = (remIndOop <= 0) ? 'Individual OOP Met' : 'Family OOP Met'; }

    if (oopMet) {
        return {
             benefits, patientId: metaData.patient.memberId,
             procedureEstimates: procedures.map(p => ({ ...p, totalPatientResponsibility: 0.0, calculationBreakdown: [{ description: reason, patientOwes: 0.0, notes: `Patient's OOP max is met or set to $0.` }] })),
             totalPatientResponsibility: 0.0,
             finalAccumulators: { patient: currentPatientAcc, family: currentFamilyAcc },
             metaData
         }
    }

    // --- Separate Preventive Services & Sort Standard Procedures by Allowed Amount ---
    const preventiveProcedures = procedures.filter(p => p.isPreventive);
    let standardProcedures = procedures
        .filter(p => !p.isPreventive)
        .sort((a, b) => (Number(b.allowedAmount) || 0) - (Number(a.allowedAmount) || 0))
        .map((p, index) => ({...p, calculationRank: index + 1}));


    preventiveProcedures.forEach(p => {
        procedureEstimates.push({
            ...p,
            totalPatientResponsibility: 0.0,
            calculationBreakdown: [{ description: "Preventive Service", patientOwes: 0.0, notes: "This service is covered at 100% by the plan." }]
        });
    });

    // --- LOGIC ROUTER for standard services ---
    let standardProcResult = { totalPatientResponsibility: 0, procedureEstimates: [], finalAccumulators: { patient: currentPatientAcc, family: currentFamilyAcc }};

    if (standardProcedures.length > 0) {
        switch(benefits.copayLogic) {
            case 'highest_copay_only': {
                const highestCopay = standardProcedures.reduce((max, p) => Math.max(max, Number(p.copay) || 0), 0);
                let remOop = planAwareRemOop(benefits.individualOopMax, benefits.familyOopMax, currentPatientAcc.oopMet, currentFamilyAcc?.oopMet, benefits.planType);
                const resp = $(Math.min(highestCopay, remOop));

                standardProcResult.totalPatientResponsibility = resp;
                currentPatientAcc.oopMet = $(currentPatientAcc.oopMet + resp);
                if (currentFamilyAcc) currentFamilyAcc.oopMet = $(currentFamilyAcc.oopMet + resp);
                
                const breakdown = [{ description: "Highest Copay Applied", patientOwes: resp, notes: `The highest copay of $${highestCopay.toFixed(2)} is the total cost.` }];
                standardProcResult.procedureEstimates = standardProcedures.map(p => ({ ...p, totalPatientResponsibility: 0, calculationBreakdown: [] }));
                if (standardProcResult.procedureEstimates.length > 0) {
                    standardProcResult.procedureEstimates[0].totalPatientResponsibility = resp;
                    standardProcResult.procedureEstimates[0].calculationBreakdown = breakdown;
                }
                break;
            }

            case 'highest_copay_plus_remainder': {
                let highestCopay = 0;
                let highestCopayProc = null;
                
                // Find the procedure with the highest copay (and highest allowed amount as a tie-breaker)
                standardProcedures.forEach(p => {
                    const currentCopay = Number(p.copay) || 0;
                    if (currentCopay > highestCopay) {
                        highestCopay = currentCopay;
                        highestCopayProc = p;
                    } else if (currentCopay === highestCopay && highestCopay > 0) {
                        // Tie-breaker: choose the one with the higher allowed amount
                        if ( (Number(p.allowedAmount) || 0) > (Number(highestCopayProc.allowedAmount) || 0) ) {
                            highestCopayProc = p;
                        }
                    }
                });
                
                if (!highestCopayProc) {
                    const waterfallResult = runWaterfall(standardProcedures, benefits, currentPatientAcc, currentFamilyAcc, false);
                    standardProcResult = waterfallResult;
                } else {
                    let remOop = planAwareRemOop(benefits.individualOopMax, benefits.familyOopMax, currentPatientAcc.oopMet, currentFamilyAcc?.oopMet, benefits.planType);
                    const copayDue = $(Math.min(highestCopay, remOop));
                    standardProcResult.totalPatientResponsibility = $(standardProcResult.totalPatientResponsibility + copayDue);
                    currentPatientAcc.oopMet = $(currentPatientAcc.oopMet + copayDue);
                    if (currentFamilyAcc) currentFamilyAcc.oopMet = $(currentFamilyAcc.oopMet + copayDue);
                    
                    standardProcResult.procedureEstimates.push({ ...highestCopayProc, totalPatientResponsibility: copayDue, calculationBreakdown: [{ description: `Highest Copay for ${highestCopayProc?.cptCode}`, patientOwes: copayDue, notes: `Applied as a separate fee.` }] });
                    
                    const remainingProcedures = standardProcedures.filter(p => p.id !== highestCopayProc.id);
                    const waterfallResult = runWaterfall(remainingProcedures, benefits, currentPatientAcc, currentFamilyAcc, true); // ignoreCopays = true
                    
                    standardProcResult.totalPatientResponsibility = $(standardProcResult.totalPatientResponsibility + waterfallResult.totalPatientResponsibility);
                    standardProcResult.procedureEstimates.push(...waterfallResult.procedureEstimates);
                    currentPatientAcc = waterfallResult.finalAccumulators.patient;
                    currentFamilyAcc = waterfallResult.finalAccumulators.family;
                }
                break;
            }

            case 'standard_waterfall':
            default: {
                const waterfallResult = runWaterfall(standardProcedures, benefits, currentPatientAcc, currentFamilyAcc, false);
                standardProcResult.totalPatientResponsibility = waterfallResult.totalPatientResponsibility;
                standardProcResult.procedureEstimates = waterfallResult.procedureEstimates;
                currentPatientAcc = waterfallResult.finalAccumulators.patient;
                currentFamilyAcc = waterfallResult.finalAccumulators.family;
                break;
            }
        }
    }
    
    totalPatientResponsibility = standardProcResult.totalPatientResponsibility;
    procedureEstimates.push(...standardProcResult.procedureEstimates);
    procedureEstimates.sort((a,b) => procedures.findIndex(p => p.id === a.id) - procedures.findIndex(p => p.id === b.id));


    return { benefits, patientId: metaData.patient.memberId, procedureEstimates, totalPatientResponsibility, finalAccumulators: { patient: currentPatientAcc, family: currentFamilyAcc }, metaData };
};

const runWaterfall = (procedures, benefits, patientAcc, familyAcc, ignoreCopays = false) => {
    let currentPatientAcc = JSON.parse(JSON.stringify(patientAcc));
    let currentFamilyAcc = familyAcc ? JSON.parse(JSON.stringify(familyAcc)) : null;
    let procedureEstimates = [];
    let totalPatientResponsibility = 0.0;
    
    const getRemaining = (limit, met) => {
        if (limit === null || limit === undefined || limit === '') return Infinity;
        const numLimit = Number(limit) || 0;
        const numMet = Number(met) || 0;
        if (numLimit === 0 && (limit?.toString().trim() === '0')) return 0;
        return Math.max(0, numLimit - numMet);
    };

    for (const procedure of procedures) {
        const { modifiedAllowedAmount, modifierNote, originalAllowedAmount } = applyModifiers(procedure);

        let breakdown = [];
        if (modifierNote) {
            breakdown.push(modifierNote);
        }

        const b = Number(procedure.billedAmount);
        const billedSafe = isNaN(b) ? Infinity : Math.max(0, b);
        const finalAllowed = Math.min(modifiedAllowedAmount, billedSafe);
        let amountRemainingForCalc = finalAllowed;

        if (finalAllowed < modifiedAllowedAmount) {
            breakdown.push({
                description: 'Allowed capped to Billed',
                patientOwes: 0,
                notes: `Allowed $${modifiedAllowedAmount.toFixed(2)} > Billed $${(Number(procedure.billedAmount) || 0).toFixed(2)}; using billed.`
            });
        }
        
        let patientPortion = 0.0;
        
        const getRemOopNow = () => planAwareRemOop(benefits.individualOopMax, benefits.familyOopMax, currentPatientAcc.oopMet, currentFamilyAcc?.oopMet, benefits.planType);
        
        const procedureCopay = !ignoreCopays ? (Number(procedure.copay) || 0) : 0;
        if (procedureCopay > 0) {
            const copayDue = $(Math.min(procedureCopay, getRemOopNow()));
            patientPortion = $(patientPortion + copayDue);
            currentPatientAcc.oopMet = $(currentPatientAcc.oopMet + copayDue);
            if (currentFamilyAcc) currentFamilyAcc.oopMet = $(currentFamilyAcc.oopMet + copayDue);
            breakdown.push({ description: `Copay for ${procedure.cptCode}`, patientOwes: copayDue, notes: `Applied as a separate fee.` });
        }
        
        let remIndDed = getRemaining(benefits.individualDeductible, currentPatientAcc.deductibleMet);
        let remFamDed = currentFamilyAcc ? getRemaining(benefits.familyDeductible, currentFamilyAcc.deductibleMet) : Infinity;
        let deductibleMetForPatient = (benefits.planType === 'Individual' && remIndDed <= 0) || (benefits.planType === 'AggregateFamily' && remFamDed <= 0) || (benefits.planType === 'EmbeddedFamily' && (remIndDed <= 0 || remFamDed <= 0));

        if (!deductibleMetForPatient && amountRemainingForCalc > 0) {
            let dedApplicable = (benefits.planType === 'Individual') ? remIndDed : (benefits.planType === 'AggregateFamily') ? remFamDed : Math.min(remIndDed, remFamDed);
            const deductiblePayment = $(Math.min(amountRemainingForCalc, dedApplicable, getRemOopNow()));
            
            if (deductiblePayment > 0) {
                patientPortion = $(patientPortion + deductiblePayment);
                amountRemainingForCalc = $(amountRemainingForCalc - deductiblePayment);
                currentPatientAcc.deductibleMet = $(currentPatientAcc.deductibleMet + deductiblePayment);
                currentPatientAcc.oopMet = $(currentPatientAcc.oopMet + deductiblePayment);
                if (currentFamilyAcc) { 
                    currentFamilyAcc.deductibleMet = $(currentFamilyAcc.deductibleMet + deductiblePayment);
                    currentFamilyAcc.oopMet = $(currentFamilyAcc.oopMet + deductiblePayment);
                }
                breakdown.push({ description: "Deductible", patientOwes: deductiblePayment, notes: `Amount left for coinsurance: $${amountRemainingForCalc.toFixed(2)}` });
            }
        }
        
        if (amountRemainingForCalc > 0) {
            const coinsurancePct = procedure.coinsurancePercentage !== '' && procedure.coinsurancePercentage !== null && procedure.coinsurancePercentage !== undefined ? procedure.coinsurancePercentage : benefits.coinsurancePercentage;
            const coinsuranceShare = $(amountRemainingForCalc * (Number(coinsurancePct) / 100));
            const coinsurancePayment = $(Math.min(coinsuranceShare, getRemOopNow()));
            
            if (coinsurancePayment > 0) {
                patientPortion = $(patientPortion + coinsurancePayment);
                currentPatientAcc.oopMet = $(currentPatientAcc.oopMet + coinsurancePayment);
                if (currentFamilyAcc) currentFamilyAcc.oopMet = $(currentFamilyAcc.oopMet + coinsurancePayment);
                breakdown.push({ description: "Coinsurance", patientOwes: coinsurancePayment, notes: `Patient pays ${coinsurancePct}% of $${amountRemainingForCalc.toFixed(2)}.` });
            }
        }

        if (patientPortion > finalAllowed) {
            breakdown.push({
                description: 'Responsibility Capped',
                patientOwes: 0,
                notes: `Patient portion ($${patientPortion.toFixed(2)}) capped at allowed amount ($${finalAllowed.toFixed(2)}).`
            });
            patientPortion = finalAllowed;
        }
        
        totalPatientResponsibility = $(totalPatientResponsibility + patientPortion);
        procedureEstimates.push({ ...procedure, modifiedAllowedAmount, finalAllowedAmount: finalAllowed, totalPatientResponsibility: patientPortion, calculationBreakdown: breakdown });
    }
    return { procedureEstimates, totalPatientResponsibility, finalAccumulators: { patient: currentPatientAcc, family: currentFamilyAcc } };
}

// --- UI COMPONENTS ---
const InfoTooltip = ({ text }) => ( <div className="group relative flex items-center"> <Info className="h-4 w-4 text-gray-400 cursor-pointer" /> <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-2 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">{text}</div> </div> );
const InputField = ({ label, type = "text", value, onChange, name, placeholder, tooltip, disabled=false, warning=false, ...rest }) => ( 
    <div className="flex flex-col space-y-1"> 
        <label className="text-sm font-medium text-gray-600 flex items-center space-x-2"> 
            <span>{label}</span> 
            {tooltip && <InfoTooltip text={tooltip} />}
        </label> 
        <div className="relative">
            <input 
                type={type} name={name} value={value ?? ''} onChange={onChange} placeholder={placeholder} disabled={disabled} 
                className={`p-2 w-full border rounded-md shadow-sm focus:ring-2 focus:border-blue-500 transition disabled:bg-gray-100 ${warning ? 'border-yellow-500 focus:ring-yellow-400' : 'border-gray-300 focus:ring-blue-500'}`}
                {...rest}
            />
            {warning && 
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <div className="group cursor-default">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        <div className="absolute right-full mr-2 w-max p-2 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">Allowed amount is greater than billed amount.</div>
                    </div>
                </div>
            }
        </div>
    </div> 
);
const Card = ({ title, icon, children, disabled = false }) => ( <div className={`bg-white p-6 rounded-xl shadow-lg border border-gray-200/80 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}> <h3 className="text-lg font-semibold text-gray-800 border-b pb-3 mb-4 flex items-center space-x-2">{icon}{title}</h3> <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div> {disabled && <div className="text-xs text-center text-gray-500 mt-2">These benefits are not applicable for the selected plan type.</div>} </div> );

const INSURANCE_PAYERS = [
  'Aetna', 'Aflac', 'Allianz', 'Allstate', 'Amerigroup', 'Anthem', 'Assurant', 'Asuris Northwest Health',
  'AvMed', 'Blue Cross Blue Shield', 'BridgeSpan', 'Cambia Health Solutions', 'Capital BlueCross',
  'CareFirst', 'CareSource', 'Centene Corporation', 'Cerulean', 'Cigna', 'Coventry Health Care',
  'Dean Health Plan', 'Delta Dental', 'EmblemHealth', 'Fallon Health', 'Florida Blue', 'Geisinger',
  'Group Health Cooperative', 'Harvard Pilgrim Health Care', 'Health Alliance Plan (HAP)',
  'Health Care Service Corporation (HCSC)', 'Health Net', 'Health New England', 'HealthPartners',
  'Highmark', 'Horizon Blue Cross Blue Shield of New Jersey', 'Humana', 'Independence Blue Cross',
  'Kaiser Permanente', 'Liberty Mutual', 'LifeWise Health Plan of Oregon',
  'LifeWise Health Plan of Washington', 'Magellan Health', 'Medical Mutual of Ohio', 'MetLife',
  'Molina Healthcare', 'MVP Health Care', 'Oscar Health', 'Premera Blue Cross', 'Principal Financial Group',
  'Priority Health', 'Providence Health Plan', 'Regence', 'Security Health Plan', 'SelectHealth',
  'Tufts Health Plan', 'UnitedHealthcare', 'UPMC Health Plan', 'Wellcare', 'Wellmark Blue Cross Blue Shield'
];


const InsuranceCombobox = ({ value, onChange }) => {
    const [searchTerm, setSearchTerm] = useState(value);
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        setSearchTerm(value);
    }, [value]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);
    
    const filteredPayers = useMemo(() => 
        !searchTerm ? INSURANCE_PAYERS : INSURANCE_PAYERS.filter(p => p.toLowerCase().includes(searchTerm.toLowerCase())),
    [searchTerm]);

    const handleSelect = (payer) => {
        onChange(payer);
        setSearchTerm(payer);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={wrapperRef}>
            <InputField 
                label="Insurance Plan" 
                value={searchTerm} 
                onChange={e => { setSearchTerm(e.target.value); onChange(e.target.value); setIsOpen(true); }} 
                onFocus={() => setIsOpen(true)}
                placeholder="Search or type payer name"
            />
            {isOpen && (
                <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
                    {filteredPayers.length > 0 ? filteredPayers.map(payer => (
                        <li 
                            key={payer} 
                            className="p-2 hover:bg-blue-100 cursor-pointer text-sm"
                            onMouseDown={() => handleSelect(payer)}
                        >
                            {payer}
                        </li>
                    )) : <li className="p-2 text-sm text-gray-500">No matching payers found.</li>}
                </ul>
            )}
        </div>
    );
};

// --- Initial State Definitions (Moved to Global Scope) ---
const blankBenefitsState = {
    planType: 'EmbeddedFamily', individualDeductible: '', individualOopMax: '',
    familyDeductible: '', familyOopMax: '', coinsurancePercentage: '',
    copayLogic: 'standard_waterfall',
};
const blankPatientAccumulatorsState = { deductibleMet: '', oopMet: '' };
const blankFamilyAccumulatorsState = { deductibleMet: '', oopMet: '' };
const blankProceduresState = [ { id: 1, cptCode: '', billedAmount: '', allowedAmount: '', copay: '', coinsurancePercentage: '', modifiers: '', dxCode: '', isPreventive: false } ];
const blankMetaData = {
    patient: { name: '', memberId: '', dob: '' },
    insurance: { name: '' },
    practice: { name: '', taxId: '' },
    provider: { name: '', npi: '' },
    service: { date: '' }
};

// --- PAGE 1: ESTIMATE FORM ---
const EstimateForm = ({ 
    benefits, setBenefits, 
    patientAccumulators, setPatientAccumulators,
    familyAccumulators, setFamilyAccumulators,
    procedures, setProcedures,
    metaData, setMetaData,
    handleReset,
    setEstimateData, setPage,
    showModal
}) => {
    
    useEffect(() => {
        if (benefits.planType === 'Individual') {
            setBenefits(prev => ({ ...prev, familyDeductible: '', familyOopMax: '' }));
            setFamilyAccumulators({ deductibleMet: '', oopMet: '' });
        } else if (benefits.planType === 'AggregateFamily') {
            setBenefits(prev => ({ ...prev, individualDeductible: '', individualOopMax: '' }));
            setPatientAccumulators({ deductibleMet: '', oopMet: '' });
        }
    }, [benefits.planType, setBenefits, setFamilyAccumulators, setPatientAccumulators]);

    const handleMetaDataChange = (section, e) => {
        const { name, value } = e.target;
        setMetaData(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [name]: value
            }
        }));
    };
    const handleInsuranceChange = (value) => {
        setMetaData(prev => ({
            ...prev,
            insurance: { ...prev.insurance, name: value }
        }));
    };
    const handleBenefitChange = (e) => { const { name, value } = e.target; setBenefits(prev => ({ ...prev, [name]: value })); };
    const handlePatientAccChange = (e) => { const { name, value } = e.target; setPatientAccumulators(prev => ({ ...prev, [name]: value === '' ? '' : value })); };
    const handleFamilyAccChange = (e) => { const { name, value } = e.target; setFamilyAccumulators(prev => ({ ...prev, [name]: value === '' ? '' : value })); };
    const handleProcedureChange = (id, e) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;
        setProcedures(prev => prev.map(p => {
            if (p.id === id) {
                const updatedP = { ...p, [name]: val };
                if (name === 'isPreventive' && checked) {
                    updatedP.copay = 0;
                    updatedP.coinsurancePercentage = 0;
                }
                return updatedP;
            }
            return p;
        }));
    };
    const addProcedure = () => setProcedures(prev => [...prev, { id: Date.now(), cptCode: '', billedAmount: '', allowedAmount: '', copay: '', coinsurancePercentage: '', modifiers: '', dxCode: '', isPreventive: false }]);
    const removeProcedure = (id) => setProcedures(prev => prev.filter(p => p.id !== id));

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // --- START NEW VALIDATION LOGIC ---
        const requiredMetaData = {
            "Patient Name": metaData.patient.name,
            "Member ID": metaData.patient.memberId,
            "Practice Name": metaData.practice.name,
            "Provider Name": metaData.provider.name,
            "Date of Service": metaData.service.date,
        };

        for (const [fieldName, value] of Object.entries(requiredMetaData)) {
            if (!value || String(value).trim() === '') {
                showModal('Missing Information', `Please enter a value for "${fieldName}".`);
                return;
            }
        }

        const activeProcedures = procedures.filter(p =>
            p.cptCode || p.billedAmount || p.allowedAmount || p.copay || p.coinsurancePercentage || p.modifiers || p.dxCode
        );

        if (activeProcedures.length === 0) {
            showModal('Missing Information', 'Please add at least one procedure to calculate an estimate.');
            return;
        }
        
        if (procedures.length > activeProcedures.length) {
             showModal('Incomplete Procedure', 'You have added one or more procedure lines that are completely blank. Please either fill in the details or delete the blank lines before calculating.');
             return;
        }

        for (const [index, proc] of activeProcedures.entries()) {
            const originalIndex = procedures.findIndex(p => p.id === proc.id);
            if (!proc.cptCode || proc.allowedAmount === '' || proc.allowedAmount === null) {
                showModal('Incomplete Procedure', `Procedure #${originalIndex + 1} is missing a CPT Code or an Allowed Amount.`);
                return;
            }
        }
        
        if (metaData.patient.dob) {
            const dob = new Date(metaData.patient.dob + 'T00:00:00');
            const today = new Date();
            today.setHours(0,0,0,0);
            if (dob > today) {
                showModal('Validation Error', 'Date of Birth cannot be in the future.');
                return;
            }
        }
        
        if (benefits.planType === 'EmbeddedFamily') {
            const indDed = Number(benefits.individualDeductible);
            const famDed = Number(benefits.familyDeductible);
            if (indDed && famDed && indDed > famDed) {
                showModal('Validation Error', 'Individual Deductible cannot be greater than Family Deductible.');
                return;
            }
            const indOop = Number(benefits.individualOopMax);
            const famOop = Number(benefits.familyOopMax);
            if (indOop && famOop && indOop > famOop) {
                showModal('Validation Error', 'Individual OOP Max cannot be greater than Family OOP Max.');
                return;
            }
        }
        
        if (Number(patientAccumulators.deductibleMet) > Number(benefits.individualDeductible)) {
            showModal('Validation Error', 'Individual Deductible Met cannot be greater than the Individual Deductible maximum.');
            return;
        }
        if (Number(patientAccumulators.oopMet) > Number(benefits.individualOopMax)) {
            showModal('Validation Error', 'Individual OOP Met cannot be greater than the Individual OOP maximum.');
            return;
        }
        if (Number(familyAccumulators.deductibleMet) > Number(benefits.familyDeductible)) {
            showModal('Validation Error', 'Family Deductible Met cannot be greater than the Family Deductible maximum.');
            return;
        }
        if (Number(familyAccumulators.oopMet) > Number(benefits.familyOopMax)) {
            showModal('Validation Error', 'Family OOP Met cannot be greater than the Family OOP maximum.');
            return;
        }

        const familyAcc = benefits.planType !== 'Individual' ? familyAccumulators : null;
        const result = calculateEstimate(benefits, patientAccumulators, familyAcc, activeProcedures, metaData);
        setEstimateData(result);
        setPage('results');
    };
    
    const isFamilyPlan = useMemo(() => benefits.planType !== 'Individual', [benefits.planType]);
    const isIndividualBenefitsDisabled = useMemo(() => benefits.planType === 'AggregateFamily', [benefits.planType]);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex justify-end mb-4">
                 <button type="button" onClick={handleReset} className="flex items-center space-x-2 text-sm bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition">
                    <XCircle className="h-4 w-4" />
                    <span>Clear Form</span>
                </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title="Patient & Insurance" icon={<User className="text-blue-600" />}>
                    <InputField label="Patient Name" name="name" value={metaData.patient.name} onChange={e => handleMetaDataChange('patient', e)} />
                    <InputField label="Member ID" name="memberId" value={metaData.patient.memberId} onChange={e => handleMetaDataChange('patient', e)} />
                    <InputField label="Date of Birth" name="dob" type="date" value={metaData.patient.dob} onChange={e => handleMetaDataChange('patient', e)} />
                    <InsuranceCombobox value={metaData.insurance.name} onChange={handleInsuranceChange} />
                </Card>
                 <Card title="Practice & Service Details" icon={<Stethoscope className="text-blue-600" />}>
                    <InputField label="Practice Name" name="name" value={metaData.practice.name} onChange={e => handleMetaDataChange('practice', e)} />
                    <InputField label="Practice Tax ID" name="taxId" value={metaData.practice.taxId} onChange={e => handleMetaDataChange('practice', e)} />
                    <InputField label="Provider Name" name="name" value={metaData.provider.name} onChange={e => handleMetaDataChange('provider', e)} />
                    <InputField label="Date of Service" name="date" type="date" value={metaData.service.date} onChange={e => handleMetaDataChange('service', e)} />
                </Card>
            </div>

            <Card title="Plan Benefits" icon={<Briefcase className="text-blue-600" />}>
                <div>
                    <label className="text-sm font-medium text-gray-600">Plan Type</label>
                    <select name="planType" value={benefits.planType} onChange={handleBenefitChange} className="w-full p-2 border border-gray-300 rounded-md shadow-sm">
                        <option value="EmbeddedFamily">Embedded Family</option>
                        <option value="AggregateFamily">Aggregate Family (Family Only)</option>
                        <option value="Individual">Individual</option>
                    </select>
                </div>
                <InputField type="number" label="Default Coinsurance (%)" name="coinsurancePercentage" value={benefits.coinsurancePercentage} onChange={handleBenefitChange} placeholder="e.g., 20" tooltip="This is used if a per-service coinsurance is not specified below." />
                <div className="md:col-span-2">
                    <label className="text-sm font-medium text-gray-600 flex items-center space-x-2"><span>Copayment Logic</span> <InfoTooltip text="Select how this plan handles copayments. This is the most critical setting for accuracy." /></label>
                    <select name="copayLogic" value={benefits.copayLogic} onChange={handleBenefitChange} className="w-full p-2 border border-gray-300 rounded-md shadow-sm">
                        <option value="standard_waterfall">Apply Each Copay, then Deductible/Coinsurance</option>
                        <option value="highest_copay_only">Apply Highest Copay Only (as Total Cost)</option>
                        <option value="highest_copay_plus_remainder">Apply Highest Copay, then Ded/Coins on Other Services</option>
                    </select>
                </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <Card title="Individual Accumulators" disabled={isIndividualBenefitsDisabled}><InputField type="number" label="Deductible ($)" name="individualDeductible" value={benefits.individualDeductible} onChange={handleBenefitChange} tooltip="Enter 0 if no individual deductible applies." /><InputField type="number" label="Out-of-Pocket Max ($)" name="individualOopMax" value={benefits.individualOopMax} onChange={handleBenefitChange} tooltip="Enter 0 if the plan covers 100% from the start."/><InputField type="number" label="Deductible Met ($)" name="deductibleMet" value={patientAccumulators.deductibleMet} onChange={handlePatientAccChange} /><InputField type="number" label="OOP Met ($)" name="oopMet" value={patientAccumulators.oopMet} onChange={handlePatientAccChange} /></Card>
                 <Card title="Family Accumulators" disabled={!isFamilyPlan}><InputField type="number" label="Deductible ($)" name="familyDeductible" value={benefits.familyDeductible} onChange={handleBenefitChange} /><InputField type="number" label="Out-of-Pocket Max ($)" name="familyOopMax" value={benefits.familyOopMax} onChange={handleBenefitChange} /><InputField type="number" label="Deductible Met ($)" name="deductibleMet" value={familyAccumulators.deductibleMet} onChange={handleFamilyAccChange} /><InputField type="number" label="OOP Met ($)" name="oopMet" value={familyAccumulators.oopMet} onChange={handleFamilyAccChange} /></Card>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200/80">
                 <h3 className="text-lg font-semibold text-gray-800 border-b pb-3 mb-4">Procedures</h3>
                 <div className="space-y-4">
                     {procedures.map((p, index) => (
                        <div key={p.id} className="grid grid-cols-1 md:grid-cols-8 gap-x-4 gap-y-2 bg-gray-50 p-3 rounded-lg items-start">
                           <InputField label={`CPT #${index+1}`} name="cptCode" value={p.cptCode} onChange={e => handleProcedureChange(p.id, e)} placeholder="e.g., 99214" />
                           <InputField label="DX Codes" name="dxCode" value={p.dxCode} onChange={e => handleProcedureChange(p.id, e)} placeholder="e.g., M17.11" tooltip="Primary diagnosis code. May impact coverage."/>
                           <InputField label="Modifiers" name="modifiers" value={p.modifiers} onChange={e => handleProcedureChange(p.id, e)} placeholder="e.g., 50, LT" tooltip="Comma-separated list. Pricing modifiers like 50 or 62 will adjust the allowed amount."/>
                           <InputField type="number" label="Copay ($)" name="copay" value={p.copay} onChange={e => handleProcedureChange(p.id, e)} placeholder="e.g., 50" disabled={p.isPreventive} />
                           <InputField type="number" label="Coins. (%)" name="coinsurancePercentage" value={p.coinsurancePercentage} onChange={e => handleProcedureChange(p.id, e)} placeholder={`${benefits.coinsurancePercentage}%`} disabled={p.isPreventive} />
                           <InputField type="number" label="Billed ($)" name="billedAmount" value={p.billedAmount} onChange={e => handleProcedureChange(p.id, e)} placeholder="e.g., 400" />
                           <InputField type="number" label="Allowed ($)" name="allowedAmount" value={p.allowedAmount} onChange={e => handleProcedureChange(p.id, e)} placeholder="e.g., 250" warning={ p.allowedAmount !== '' && p.billedAmount !== '' && Number(p.allowedAmount) > Number(p.billedAmount) } />
                           <div className="flex flex-col items-center space-y-2 mt-1">
                                <label className="text-sm font-medium text-gray-600">Actions</label>
                                <div className="flex items-center h-10 space-x-3">
                                <button type="button" onClick={() => removeProcedure(p.id)} className="text-red-500 hover:text-red-700 transition"><Trash2 className="h-5 w-5"/></button>
                                <div className="group relative flex items-center">
                                    <input type="checkbox" name="isPreventive" checked={p.isPreventive} onChange={e => handleProcedureChange(p.id, e)} className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"/>
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max p-2 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">Preventive Service (100% Covered)</div>
                                </div>
                               </div>
                           </div>
                        </div>
                     ))}
                 </div>
                 <button type="button" onClick={addProcedure} className="mt-4 flex items-center space-x-2 text-blue-600 font-medium hover:text-blue-800 transition"><PlusCircle className="h-5 w-5" /><span>Add Procedure</span></button>
            </div>
            
            <div className="flex justify-end pt-4">
                <button type="submit" className="flex items-center space-x-2 bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-blue-700 transition transform hover:scale-105">
                    <span>Calculate Estimate</span>
                    <ArrowRight className="h-5 w-5" />
                </button>
            </div>
        </form>
    );
};

// --- PAGE 2: RESULTS DISPLAY & PDF GENERATION ---
const EstimateResults = ({ data, setPage, scriptsLoaded }) => {
    
    const copayLogicDescriptions = {
        standard_waterfall: "Each service's copay was applied, followed by the standard deductible and coinsurance waterfall.",
        highest_copay_only: "The single highest copay was applied as the total patient cost for all services.",
        highest_copay_plus_remainder: "The highest copay was applied, and all other services were then processed against the deductible and coinsurance."
    };
    
    const { totalAppliedToDed, totalAppliedToOop } = useMemo(() => {
        let totalDed = 0;
        let totalOop = 0;
        data.procedureEstimates.forEach(p => {
            p.calculationBreakdown.forEach(step => {
                if (step.description === 'Deductible') totalDed += step.patientOwes;
                if(step.patientOwes > 0) totalOop += step.patientOwes;
            });
        });
        return { totalAppliedToDed: totalDed, totalAppliedToOop: totalOop };
    }, [data]);


    const generatePDF = () => {
        if (!scriptsLoaded) { alert("PDF generation library is still loading..."); return; }
        const doc = new window.jspdf.jsPDF();
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 14;
        const primaryColor = '#174ea6'; // Dark blue for high contrast text
        const textColor = '#1f2937'; // A very dark gray, almost black
        const lightTextColor = '#6b7280'; // A medium gray for secondary text
        const borderColor = '#e5e7eb';
        const whiteColor = '#ffffff';

        // --- PDF HELPER FUNCTIONS ---
        const drawSectionTitle = (text, y) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(textColor);
            doc.text(text, margin, y);
            return y + 8;
        };

        // --- HEADER ---
        doc.setFillColor(primaryColor);
        doc.rect(0, 0, pageW, 25, 'F');
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.setTextColor(whiteColor);
        doc.text("Heimdall Inc.", margin, 17);
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Good Faith Estimate", pageW - margin, 11, { align: 'right' });
        doc.text(`Generated: ${new Date().toLocaleDateString('en-US')}`, pageW - margin, 17, { align: 'right' });
        
        // --- PATIENT ID BAR ---
        doc.setFillColor('#f3f4f6');
        doc.rect(0, 25, pageW, 10, 'F');
        doc.setFontSize(9);
        doc.setTextColor(textColor);
        doc.text(`PATIENT ID: ${data.patientId}`, margin, 31.5);
        
        let currentY = 48;

        // --- HERO SUMMARY ---
        doc.setFillColor('#f9fafb');
        doc.setDrawColor(borderColor);
        doc.roundedRect(margin, currentY, pageW - (margin * 2), 25, 3, 3, 'FD');
        doc.setFontSize(12).setTextColor(lightTextColor).text("Total Estimated Patient Responsibility", margin + 7, currentY + 10);
        doc.setFontSize(28).setFont("helvetica", "bold").setTextColor(primaryColor).text(`$${data.totalPatientResponsibility.toFixed(2)}`, pageW - margin - 7, currentY + 16, { align: 'right' });
        currentY += 35;
        
        // --- SUB-SUMMARY CARDS (RE-ENGINEERED) ---
        const summaryBody = [
             [
                { content: 'Applied to Deductible', styles: { textColor: lightTextColor, fontSize: 10, cellPadding: {top: 6, left: 5} }},
                { content: 'Total Out-of-Pocket This Visit', styles: { textColor: lightTextColor, fontSize: 10, cellPadding: {top: 6, left: 5} }}
             ],
             [
                { content: `$${totalAppliedToDed.toFixed(2)}`, styles: { font: 'helvetica', fontStyle: 'bold', fontSize: 18, textColor: textColor, cellPadding: {bottom: 6, left: 5} }},
                { content: `$${totalAppliedToOop.toFixed(2)}`, styles: { font: 'helvetica', fontStyle: 'bold', fontSize: 18, textColor: textColor, cellPadding: {bottom: 6, left: 5} }}
             ]
        ];
        
        doc.autoTable({
            startY: currentY,
            body: summaryBody,
            theme: 'grid',
            styles: {
                fillColor: whiteColor,
                lineColor: borderColor,
                lineWidth: 0.2,
            },
        });
        currentY = doc.autoTable.previous.finalY + 15;
        
        // --- DETAILED BREAKDOWN ---
        currentY = drawSectionTitle("Detailed Breakdown", currentY);
        const tableBody = data.procedureEstimates.flatMap(p => {
            const baseAllowed = Number(p.allowedAmount||0).toFixed(2);
            const afterMods = (p.modifiedAllowedAmount ?? p.allowedAmount);
            const usedAllowed = (p.finalAllowedAmount ?? p.allowedAmount);
            const headerContent =
               `${p.isPreventive ? '✅' : '•'} CPT: ${p.cptCode} | DX: ${p.dxCode || 'N/A'} | Modifiers: ${p.modifiers || 'N/A'}\n` +
               `Allowed: $${baseAllowed}` +
               `${afterMods != null && Number(afterMods).toFixed(2) !== baseAllowed ? ` → after modifiers $${Number(afterMods).toFixed(2)}` : ''}` +
               `${usedAllowed != null && Number(usedAllowed).toFixed(2) !== Number((afterMods ?? p.allowedAmount) || 0).toFixed(2) ? ` → used $${Number(usedAllowed).toFixed(2)}` : ''}` +
               ` | Patient Owes: $${p.totalPatientResponsibility.toFixed(2)}`;

            const header = [{ 
                content: headerContent,
                colSpan: 3, 
                styles: { fontStyle: 'bold', fillColor: '#f9fafb', textColor: textColor, halign: 'left', cellPadding: 3 } 
            }];
            const breakdownRows = p.calculationBreakdown.map(step => {
                return [
                    { content: `  ${step.description}`, styles: {cellWidth: 50, cellPadding: {left: 5}}}, 
                    { content: `$${step.patientOwes.toFixed(2)}`, styles: { halign: 'right' }}, 
                    { content: step.notes, styles: { textColor: lightTextColor }}
                ];
            });
            return [header, ...breakdownRows];
        });
        doc.autoTable({
            head: [['Cost Component', 'Patient Pays', 'Calculation Notes']],
            body: tableBody,
            startY: currentY, theme: 'grid',
            headStyles: { fillColor: '#4b5563', textColor: whiteColor, fontStyle: 'bold' },
            styles: { lineColor: borderColor, lineWidth: 0.1, cellPadding: 2, fontSize: 9 },
            columnStyles: { 1: { halign: 'right' } }
        });
        currentY = doc.autoTable.previous.finalY + 10;
        
        // --- LOGIC NOTE (AFTER DETAILS) ---
        doc.setFontSize(9).setFont("helvetica", "bold").setTextColor(textColor).text("Calculation Logic Applied", margin, currentY);
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(lightTextColor);
        const logicText = doc.splitTextToSize(copayLogicDescriptions[data.benefits.copayLogic], pageW - (margin * 2));
        doc.text(logicText, margin, currentY + 4);
        currentY =  currentY + 15;
        
        // --- FINAL ACCUMULATORS ---
        currentY = drawSectionTitle("Updated Accumulator Status", currentY);
        const finalAccData = [['Patient Deductible Met', `$${(Number(data.finalAccumulators.patient.deductibleMet) || 0).toFixed(2)}`], ['Patient OOP Met', `$${(Number(data.finalAccumulators.patient.oopMet) || 0).toFixed(2)}`]];
        if (data.finalAccumulators.family) {
             finalAccData.push(['Family Deductible Met', `$${(Number(data.finalAccumulators.family.deductibleMet) || 0).toFixed(2)}`], ['Family OOP Met', `$${(Number(data.finalAccumulators.family.oopMet) || 0).toFixed(2)}`]);
        }
        doc.autoTable({ 
            body: finalAccData, startY: currentY, theme: 'plain', styles: { fontSize: 10 },
            columnStyles: { 0: { fontStyle: 'bold', textColor: textColor }, 1: { halign: 'right' } }
        });

        // --- FOOTER ---
        const disclaimer = "Disclaimer: This is a good faith estimate based on the information provided and your plan's benefits at the time of this request. The final amount you owe may vary based on the services you receive, your insurance plan's final determination of medical necessity for the provided diagnosis code(s), and the accuracy of the data entered. This is not a guarantee of payment or benefits.";
        
        // Dynamic footer positioning
        let footerY = doc.autoTable.previous.finalY + 20;
        const disclaimerHeight = doc.getTextDimensions(doc.splitTextToSize(disclaimer, pageW - (margin * 2))).h + 10;
        if (footerY + disclaimerHeight > pageH - margin) {
            doc.addPage();
            footerY = margin;
        }
        if (pageH - footerY > disclaimerHeight + 20) {
            footerY = pageH - 25;
        }

        doc.setFillColor('#f3f4f6');
        doc.rect(0, footerY - 5, pageW, 30, 'F');
        doc.setFontSize(8).setTextColor(lightTextColor).text(doc.splitTextToSize(disclaimer, pageW - (margin*2)), margin, footerY);
        
        doc.save(`GoodFaithEstimate_${data.patientId}_${new Date().toISOString().slice(0,10)}.pdf`);
    };

    return (
        <div className="space-y-8">
            <div className="text-center"> <h2 className="text-3xl font-bold text-gray-800">Calculation Complete</h2> <p className="text-gray-500 mt-1">Review the estimated patient responsibility below.</p> </div>
            <div className="bg-white p-8 rounded-xl shadow-2xl border border-gray-200/80 text-center max-w-lg mx-auto"> <p className="text-lg text-gray-600">Total Estimated Patient Responsibility</p> <p className="text-6xl font-extrabold text-blue-600 tracking-tight my-2">${data.totalPatientResponsibility.toFixed(2)}</p> </div>
             <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200/80">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Estimate Context</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>Patient:</strong> {data.metaData.patient.name} ({data.metaData.patient.memberId})</div>
                    <div><strong>Provider:</strong> {data.metaData.provider.name}</div>
                    <div><strong>Service Date:</strong> {formatDate(data.metaData.service.date)}</div>
                    <div><strong>Practice:</strong> {data.metaData.practice.name}</div>
                     <div className="col-span-2"><strong>Insurance:</strong> {data.metaData.insurance.name}</div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200/80"> 
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Calculation Logic Used</h3> 
                <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-md border border-blue-200">
                    <Info className="h-4 w-4 inline-block mr-2 text-blue-700" />
                    {copayLogicDescriptions[data.benefits.copayLogic]}
                </p> 
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200/80">
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Detailed Breakdown</h3>
                <div className="text-sm text-gray-600 bg-yellow-50 p-3 rounded-md border border-yellow-200 mb-4">
                     <Info className="h-4 w-4 inline-block mr-2 text-yellow-700" />
                    Note: For accuracy, procedures are calculated in order from the highest allowed amount to the lowest. The number in the red circle indicates the calculation order.
                </div>
                <div className="space-y-6">
                    {data.procedureEstimates.map((p, idx) => (
                        <div key={idx} className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className={`bg-gray-50 p-4 grid grid-cols-2 ${p.isPreventive ? 'bg-green-50' : 'bg-gray-50'}`}>
                                <div> 
                                    <h4 className="font-bold text-gray-700 flex items-center">
                                        {p.isPreventive && <ShieldCheck className="h-5 w-5 text-green-600 mr-2"/>}
                                        Procedure: {p.cptCode}
                                        {!p.isPreventive && p.calculationRank && <span className="ml-2 text-xs font-bold text-red-600 bg-red-100 rounded-full h-5 w-5 flex items-center justify-center">{p.calculationRank}</span>}
                                    </h4> 
                                    <p className="text-sm text-gray-500">
                                        DX: {p.dxCode || 'N/A'} | Modifiers: {p.modifiers || 'N/A'} | Billed: ${Number(p.billedAmount||0).toFixed(2)}
                                        {` | Allowed (base): $${Number(p.allowedAmount||0).toFixed(2)}`}
                                        {p.modifiedAllowedAmount != null && Number(p.modifiedAllowedAmount).toFixed(2) !== Number(p.allowedAmount||0).toFixed(2) && ` → after modifiers $${Number(p.modifiedAllowedAmount).toFixed(2)}`}
                                        {p.finalAllowedAmount != null && Number(p.finalAllowedAmount).toFixed(2) !== Number((p.modifiedAllowedAmount ?? p.allowedAmount) || 0).toFixed(2) && ` → used $${Number(p.finalAllowedAmount).toFixed(2)}`}
                                    </p>
                                </div>
                                <div className="text-right"> <p className={`font-semibold mt-1 ${p.isPreventive ? 'text-green-700' : 'text-blue-700'}`}>Patient Owes: ${p.totalPatientResponsibility.toFixed(2)}</p> </div>
                            </div>
                            <table className="w-full text-sm">
                                <thead><tr className="bg-gray-100 text-left text-gray-600"><th className="p-3 font-semibold">Cost Component</th><th className="p-3 font-semibold">Patient Pays</th><th className="p-3 font-semibold">Notes</th></tr></thead>
                                <tbody>
                                    {p.calculationBreakdown.map((step, stepIdx) => ( <tr key={stepIdx} className="border-t"><td className="p-3">{step.description}</td><td className="p-3 font-mono">${step.patientOwes.toFixed(2)}</td><td className="p-3 text-gray-500">{step.notes}</td></tr> ))}
                                    {p.calculationBreakdown.length === 0 && ( <tr className="border-t"><td colSpan="3" className="p-3 text-center text-gray-500">No patient responsibility calculated for this procedure individually.</td></tr> )}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            </div>
             <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200/80">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Final Accumulators</h3>
                 {(() => {
                   const pt = data.benefits.planType;
                   const showPatient = pt !== 'AggregateFamily';
                   const showFamily  = pt !== 'Individual' && !!data.finalAccumulators.family;
                   return (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                       {showPatient && (
                         <>
                           <div className="bg-blue-50 p-4 rounded-lg">
                             <p className="text-sm text-blue-800 font-semibold">Patient Ded Met</p>
                             <p className="text-2xl font-bold text-blue-900">${(Number(data.finalAccumulators.patient.deductibleMet)||0).toFixed(2)}</p>
                           </div>
                           <div className="bg-blue-50 p-4 rounded-lg">
                             <p className="text-sm text-blue-800 font-semibold">Patient OOP Met</p>
                             <p className="text-2xl font-bold text-blue-900">${(Number(data.finalAccumulators.patient.oopMet)||0).toFixed(2)}</p>
                           </div>
                         </>
                       )}
                       {showFamily && (
                         <>
                           <div className="bg-green-50 p-4 rounded-lg">
                             <p className="text-sm text-green-800 font-semibold">Family Ded Met</p>
                             <p className="text-2xl font-bold text-green-900">${(Number(data.finalAccumulators.family.deductibleMet)||0).toFixed(2)}</p>
                           </div>
                           <div className="bg-green-50 p-4 rounded-lg">
                             <p className="text-sm text-green-800 font-semibold">Family OOP Met</p>
                             <p className="text-2xl font-bold text-green-900">${(Number(data.finalAccumulators.family.oopMet)||0).toFixed(2)}</p>
                           </div>
                         </>
                       )}
                     </div>
                   );
                 })()}
            </div>
            <div className="flex justify-between items-center pt-4">
                 <button onClick={() => setPage('form')} className="flex items-center space-x-2 bg-gray-200 text-gray-800 font-bold py-3 px-6 rounded-lg hover:bg-gray-300 transition"><ArrowLeft className="h-5 w-5" /><span>Back to Form</span></button>
                <button onClick={generatePDF} disabled={!scriptsLoaded} className="flex items-center space-x-2 bg-green-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-green-700 transition transform hover:scale-105 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:scale-100">
                    {scriptsLoaded ? <FileDown className="h-5 w-5" /> : <Loader className="h-5 w-5 animate-spin" />}
                    <span>{scriptsLoaded ? 'Download PDF' : 'Loading...'}</span>
                </button>
            </div>
        </div>
    );
};

// --- Modal Component ---
const Modal = ({ isOpen, onClose, title, message }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md m-4">
                <div className="flex justify-between items-center border-b pb-3">
                    <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <XCircle className="h-6 w-6" />
                    </button>
                </div>
                <div className="mt-4">
                    <p className="text-sm text-gray-600">{message}</p>
                </div>
                <div className="mt-6 flex justify-end">
                    <button onClick={onClose} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition">
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP CONTAINER ---
const App = () => {
    const [page, setPage] = useState('form');
    const [estimateData, setEstimateData] = useState(null);
    const [scriptsLoaded, setScriptsLoaded] = useState(false);
    const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });

    const showModal = (title, message) => setModal({ isOpen: true, title, message });
    const hideModal = () => setModal({ isOpen: false, title: '', message: '' });

    // Lifted state for form data persistence
    const [benefits, setBenefits] = useState(blankBenefitsState);
    const [patientAccumulators, setPatientAccumulators] = useState(blankPatientAccumulatorsState);
    const [familyAccumulators, setFamilyAccumulators] = useState(blankFamilyAccumulatorsState);
    const [procedures, setProcedures] = useState(blankProceduresState);
    const [metaData, setMetaData] = useState(blankMetaData);

    const handleReset = () => {
        const isAlreadyBlank = JSON.stringify(benefits) === JSON.stringify(blankBenefitsState) &&
                               JSON.stringify(patientAccumulators) === JSON.stringify(blankPatientAccumulatorsState) &&
                               JSON.stringify(familyAccumulators) === JSON.stringify(blankFamilyAccumulatorsState) &&
                               JSON.stringify(procedures) === JSON.stringify(blankProceduresState) &&
                               JSON.stringify(metaData) === JSON.stringify(blankMetaData);
        
        if (isAlreadyBlank) {
            showModal('Already Clear', 'The form is already empty.');
        } else {
            setBenefits(blankBenefitsState);
            setPatientAccumulators(blankPatientAccumulatorsState);
            setFamilyAccumulators(blankFamilyAccumulatorsState);
            setProcedures(blankProceduresState);
            setMetaData(blankMetaData);
        }
    };

    useEffect(() => {
        const jspdfScript = document.createElement('script');
        jspdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        jspdfScript.async = true;
        jspdfScript.id = 'jspdf-script';

        jspdfScript.onload = () => {
            const autoTableScript = document.createElement('script');
            autoTableScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js';
            autoTableScript.async = true;
            autoTableScript.id = 'jspdf-autotable-script';
            autoTableScript.onload = () => setScriptsLoaded(true);
            document.head.appendChild(autoTableScript);
        };
        document.head.appendChild(jspdfScript);

        return () => {
            document.getElementById('jspdf-script')?.remove();
            document.getElementById('jspdf-autotable-script')?.remove();
        };
    }, []);

    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            <Modal isOpen={modal.isOpen} onClose={hideModal} title={modal.title} message={modal.message} />
            <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-5xl">
                <header className="text-center my-8">
                    <BrandHeader />
                    <h1 className="text-4xl font-extrabold text-gray-800 mt-4 tracking-tight"> Good Faith Patient Estimate Calculator </h1>
                    <p className="text-gray-500 mt-2 max-w-2xl mx-auto"> A C-Suite grade tool for accurately projecting patient financial responsibility with unparalleled precision. </p>
                </header>
                <main className="transition-opacity duration-500">
                    {page === 'form' ? ( 
                        <EstimateForm 
                            benefits={benefits} setBenefits={setBenefits}
                            patientAccumulators={patientAccumulators} setPatientAccumulators={setPatientAccumulators}
                            familyAccumulators={familyAccumulators} setFamilyAccumulators={setFamilyAccumulators}
                            procedures={procedures} setProcedures={setProcedures}
                            metaData={metaData} setMetaData={setMetaData}
                            handleReset={handleReset}
                            setEstimateData={setEstimateData} 
                            setPage={setPage} 
                            showModal={showModal}
                        /> 
                    ) : ( 
                        <EstimateResults data={estimateData} setPage={setPage} scriptsLoaded={scriptsLoaded} /> 
                    )}
                </main>
                <footer className="text-center text-xs text-gray-400 mt-12 pb-6">
                    <p> This is a good faith estimate and not a guarantee of final cost. Final determination is made by the payer. </p>
                    <p>&copy; {new Date().getFullYear()} Heimdall Inc. All Rights Reserved.</p>
                </footer>
            </div>
        </div>
    );
}

export default App;

