# Proteomics Visualization Web App local prototype

## Overview
Full-stack scientific web application for proteomics data analysis and visualization. Researchers use it to perform differential protein abundance analysis, visualize results with interactive plots, and run pathway enrichment analysis (GSEA).

## Workflow
(1) Welcome page
The webpage should start with a welcome page to let user select the analysis template. 

- User need one analysis template at this moment, that is 'Protein pair-wised comparison analysis'. But in the future, user need around 6 types of templates. In this prototype, if user choose other templates, show 'TBD'.

(2) Data input and user configuration page
When user selected a template, create a new session, then jump to data input and analysis configuration page. 

- Data input: User can upload proteomics data (CSV files, required) and compound data (CSV files, not required) from their local computer or from database. In this prototype, only allow user upload from local. If user choose from database, show 'TBD'.

- Experiment structure setting: the uploaded proteomics files will have its names like "PSM_ExperimentName_Condition_ReplicateNumber.csv". After proteomics data upload finished, the webapp should identify and extract all ExperimentName, Condition, and ReplicateNumber. Then display a table that show all successfully uploaded protein data file. User should select which data file are to be processed by next steps. 

Attention: If user selected samples are from > 1 ExperimentName, warn user "Samples must from the same experiment!" ; 
if user selected samples are from > 2 conditions, warn user "Sample must from 2 conditions! in paired comparison analysis!" ; 
if user selected <3 replicates for each condition, warn user "at least 3 replicates per condition required!";
Only when user selection meet all requirements, user can click "Start analysis" 

- Compound setting: if user uploaded a compound data, which must have "Corp ID" and "SMILES" to columns, then check if any 'Condition' match "Corp ID". If so, return the 'SMILES', and display an compound 2D image using RDkit package. Otherwise, show "No avaliable compound" 

- User Configuration: User must configure the following criteria. Below each selection, a short explanation is provided for user.

'Setup treatment and control': display two drop down list, 'Treatment' and 'Control'. user must choose from the conditions identified from user selected files. the two condition must be different.

'Choose organism': display a dropdown list to let user select an organism among backend organism database. when webapp start, scan the backend organism database and find out avaliable organism. an avaliable organism should have a isoform sequence fasta file, and a uniprot id to gene name matching tsv file. their file name have the organism info, like 'human', 'mouse'. When building the webapp, copy files from ./ProteinDatabase

'Remove peptide razor information (Yes/No)': In proteomics, a peptide may match to more than one protein. If user decides to remove peptide razor information, then in the data process steps, remove peptide razor information action is triggered. Otherwide, no need to do anything. However, downstream Bioinformatic Analysis will be disallowed if user select 'No'. Default setting should be 'No'.

'Use strict filtering criteria (Yes/No)': This option is to set the proteomics data processing filtering criteria. if user select "Yes", result will be more reliable, but less protein will show up in the final results. Default setting should be 'No'.

- User can click "Start analysis" after all above requirements are fulfilled.

(3) Data processing page
In this page, user can see the real-time log of data process, tell user with step is in unfinished/progress/finished and a bar of overall processing percentage. After all below data generated, tell user "data process complete" and automatically jump to the next data visualization page. 
- Step 1: combine replicates. 
Extract `Sequence`, `Modifications`, `Charge`, `Contaminant`, `Master Protein Accessions`, `Quan Info`, `Abundance FXX Sample` columns from each uploaded files, and combine all files into one tsv file called 'PSM_Abundances', with a new column 'Sample Origination' to mark each row with their condition name and replicate info. For example, 'DMSO_1', 'INCZ123456_4'. all abundance should be in the 'Abundance' column.

- step 2: Generate 'Unique PSM'.
Generate a new column 'Unique PSM'. For each row, concatenate `Sequence`, `Modifications`, `Charge` as a new unique PSM.

- step 3: Remove razor information - optional
If user selected "Yes" in 'Remove peptide razor information', perform this step, otherwise skip. for each 'Unique PSM' from the same sample, some of them may match to more than one protein, which have multiple unipror id separated by semicolons in `Master Protein Accessions`, like 'O123456; P456789-2; Q637429'. The protein that with the most number of Unique_PSM matched to are selected as the final matched protein. if more than one proteins have the highest number of unique psm matched to, the longer protein according to the fasta database should be selected. if there still has more than one protein after protein length judgement, select the front one in `Master Protein Accessions`. For example, if O123456 matched to 5 unique psm, P456789-2 and Q637429 matched to 10 peptides; P456789-2 peptide length is 300 aa, Q637429 peptide length is 200 aa. Q637429 should be selected and the other two should be removed.

- step 4: Remove badlow quality unique psm
remove unique psm with:
`Contaminate` = True
`Quan Info` = No Value
`Abundance` < 1

- step 5: filter based on user configuration
If user selected 'Yes' in 'Use strict filtering criteria', then remove `unique psm` that have >20% missing values among either condition (for example, 1 missing in 5 replicates is fine, but 2 missing is not ok). Also remove `Master Protein Accessions` has only one `unique psm` matched to.
If user selected 'No' in 'Use strict filtering criteria', then remove `unique psm` that have >40% missing values among either condition (for example, 2 missing in 5 replicates is fine, but 3 missing is not ok).
After this step, save PSM_Abundances.tsv file. Up to this step, PSM processing is finished.

- step 6: use msqrob2 to calculate protein abundance
Create a Protein_Abundance.tsv using PSM_Abundances.tsv as input. Reformat data to fit msqrob2 input requirements, using `Unique PSM` as peptide, and `Master Protein Accessions` as protein. Then use msqrob2 package, perform log2 transformation to abundance, normalize the data by median centering, and get protein abundances by robust summarisation. 
Attention: entries with semicolon separated uniport id are treated as new protein. for example, 'O123456', 'P876543', and 'O123456; P876543' should be treated as 3 different proteins.
Create a new column `Gene Name`. For each row, each uniprot id in `Master Protein Accessions`, match the first Gene Name from GeneName database. still use semicolon to separate more than one gene name.
After this step, save Protein_Abundances.tsv file. Up to this step, Protein processing is finished.

- step 7: use msqrob2 to perform differential expression analysis
create a Diff_Expression.tsv using Protein_Abundances.tsv as input. use msqrob2 to calculate the Treatment/Control abundance ratio (logFC), p-value (pval), B_H adjusted p-value (adjPval) for each `Master Protein Accessions`.
After this step, save Diff_Expression.tsv file. Up to this step, differential expression analysis is finished.

- step 8: calculate QC metrics.
In the qcplot for next page, we need the following plots. All data for these plots should be calculated in this step and saved as file.
'PCA analysis': perform PCA analysis on protein abundance among all samples
'p-value distribution': display the p-value distribution as column plot. from 0 to 1, 20 bins
'PSM CV variance': use violinplot to display Unique psm coeffiecient of variance across all samples in a condition, and for both conditions. 
'psm intensity distribution (condition X)': for each condition, display the log2 transformed abundance distribution of unique psms for each replicates in one plot. two condition means two plots required.
'Protein intensity distribution': for each condition, display the log2 transformed abundance distribution of proteins
'data completeness': a stacked bar chat show number of missing values and non-missing values in each replicate

- step 9: perform GSEA analysis by gseapy
In the bioinfomatic analysis for next page, we need the gsea analysis result saved as files. we need the following analysis data:
GO biological processes
GO molecular function
GO cellular compartment
Reactome pathway
KEGG pathway

for each analysis, the normalized enrichemnt score (NES), enrichment pval, adjPval, leading edge genes for each pathway is required.

After this step, data processing is finished, and can jump to next page.

(4) data visualization page
this page need 3 subpage/card: Results, QC plots, Bioinfomatics. 

**Result: display the general info of the paired comparison analysis. including:
'general info': number of protein identified, define as the number of non-redundant `Master Protein Accessions` in Diff_Expression.tsv . example: '2239'

'differentially expressed protein': number of proteins significantly upregulated and downregulated based on the results of volcano plot filtering. this display should be dynamic, following the change of volcano plot. example: 'total DE protein: 300; 180 (up)/120(down)'

'volcano plot': an user interactive volcano plot generated by plotly. it should have: 
* A toggle filter including fold change (1 to 5), p-value (0 to 1), adjusted p-value (0 to 1). user can also type numbers. default value should be |fold change| > 2, p-value = 0.05, adjPvalue = 1.
* A volcano plot show all protein as dots. x-axis is log2abundance(Treatment/Control) as user defined. y-axis is calculated -log10(p-value). user input filter criteria displayed as dash lines. upregulated proteins are pink, downregulated proteins are blue, other proteins are grey. 
* user can select a subset of protein/dots. a panel let user select three selection mode: click, box, and lasso. in click mode, use can single click a dot to select one protein; click mode can only select no more than one protein; user click none dot region, nothing happen; user drag, then move the plot like pan mode. In box mode, user can select multiple dots; In lasso mode, user can select multiple dot. when protein(s) is/are selected, tell user how many protein were selected in the mode selection panel, as well as a 'clear selection' button to remove all selection. by default and after 'clear selection', no protein is selected. selected proteins are highlighted by darker color, black border, no transparency, larger size, on the top of every other dots.

'protein info': a panel to show protein information. 
* when no protein or more than one protein selected, display 'select one protein to see detail'.
* when only one protein selected, display below info for this selected protein: 
Master Protein Accessions: Uniprot ID(s) for this protein. each uniprot id is a link to its uniprot detail page (link example: https://www.uniprot.org/uniprotkb/A0JNW5/entry).
Gene name: use genename database, find matched gene names for all uniprot ids, and list gene names out in the same order. if more than one gene matched to one uniprot id
fold change: the number of fold change. not log2 transformed.
log2 fold change: log2 transformed foldchange.
p-value: calculated p-value.
adjPval: calculated adjPvalue.
number of psm: show the number of unique psm matched to this protein.
protein abundance plot: a column plot from plotly show protein abundances for each sample. y-axis should be log2 transformed abundance. order should be 'treatment_1','treatment_2'...'control_1','control_2'...
psm abundance plot: a dot-line plot from plotly show the abundance of all unique psm matched to this protein. different psm use diffent color. y-axis should be original abundance. order should be 'treatment_1','treatment_2'...'control_1','control_2'...

'Protein result chart': a user interactive, dynamic table, display protein (master protein accession), gene name, log2 fold change, p-value, adjPval, significance (significant or non-significant). if user selected any protein in the volcano plot, only display the selected protein; otherwise, display all significant proteins as filtered by volcano plot setting. when user clicked a protein in the table, display the info of this protein in the protein info panel even if more than one protein selected. when user click table header, rank table based on the clicked header. by default, rank table by adjPval from small to large. display 25 protein at the same time, and user can choose table page below the chart. should have a button to output the active table as .csv file.

**QCplot
display the following plots. all plots generated by plotly.
'PCA analysis': perform PCA analysis on protein abundance among all samples
'p-value distribution': display the p-value distribution as column plot. from 0 to 1, 20 bins
'PSM CV variance': use violinplot to display Unique psm coeffiecient of variance across all samples in a condition, and for both conditions. 
'psm intensity distribution (condition X)': for each condition, display the log2 transformed abundance distribution of unique psms for each replicates in one plot. two condition means two plots required.
'Protein intensity distribution': for each condition, display the log2 transformed abundance distribution of proteins
'data completeness': a stacked bar chat show number of missing values and non-missing values in each replicate

**bioinfomatics
display gsea analysis result. by default, display GO biological processes result. user can select other results by click a drop down list. during switch, display 'processing'.

'overview': number of total significant pathway (defined as pathway adjPval <= 0.05) and number of overrepresented, underrepresented pathways.
'Top enriched pathways': a bar chart show pathways with highest 5 and lowest 5 NES. x-axis is NES. user can click one pathway (and no more than one) to select.
'Enriched pathways': a interactive table show all pathways with |NES|>=1. user can click one pathway (and no more than one) to select. user can click headers to rank. table header should have 'pathway name','NES','pval','adjPval','number of gene' from gsea analysis output. should have a button to output the active table as .csv file. display 25 pathways at the same time, and user can choose table page below the chart.
'pathway details': a panel to display pathway info. when user selected one pathway, display 'pathway name','NES','pval','adjPval','number of gene', 'leading edge gene list' (show 10 gene name by default, user can click 'show more' to see full list), and a gseaplot (check 'gseaplot' function in gseapy package).

(5) extra functions

#Function 1 - session manager
On website left is a session manager panel. when user launch this webapp, automatically scan the backend for old sessions and list them in the session manager. user can click a session to resume their work. when user click "new analysis" on the welcome page, start a new session.

#Function 2 - export pdf reports
at the data visualization page, user should be able to click a 'export reports' to download a pdf report. this report should be well organized. should have all sample info, user configuration, active result, qcplot, and bioinformatics page content.


(6) extra requirements
# ui design/frontend design requirement: use #E73564 as highlight color one, #00ADEF as highlight color two. use web search to find a color scheme that matches these two color, and can be used as other highlight colors. background should be white. website should be user friendly and well organized. all plots should be easy to read.

# test requirement: all test scripts and generated files must store in ./tests with a organized manner.

# project complete standards: to call this webapp is build successfully, these endpoint must be met through browser automation test, confirm by looking and understanding screenshot and output contents.
- sample data file and compound file uploaded
- select all replicates
- select remove razor information and not select strict filter criteria
- data process all passed and reached data visualization page
- result page displayed correctly, with 1. overview panel display correct numbers 2. volcano plot can select dot by all modes 3. can adjust volcano plot toggle filter to change criteria, and volcano plot, protein table showing corresponding changes 4. when select one protein, show protein info in correct panel 5. protein table is interactive as listed in the @Proteomics Visualization Web App requirements.md . can output csv.
- qcplot page displayed correctly with all required plots. no empty plots.
- bioinformatics page displayed correctly with all required contents. can change database. can click one pathway to show detail. has gseaplot. can output csv.
- can output report pdf with required content. pdf is well organized.

#


