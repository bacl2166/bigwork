from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ProjectInput(Contract):
    name: str = Field(min_length=1, max_length=80)
    resume: str = Field(min_length=1, max_length=5000)
    job: str = Field(min_length=1, max_length=3000)


class ProjectUpdate(ProjectInput):
    revision: int = Field(ge=0)


class Evidence(Contract):
    quote: str = Field(min_length=1, max_length=800)
    reason: str = Field(min_length=1, max_length=400)


class Requirement(Contract):
    name: str = Field(min_length=1, max_length=80)
    importance: Literal['required', 'preferred']
    job_quote: str = Field(min_length=1, max_length=500)
    evidence: list[Evidence] = Field(max_length=3)


class Issue(Contract):
    quote: str = Field(min_length=1, max_length=800)
    problem: str = Field(min_length=1, max_length=500)
    suggestion: str = Field(min_length=1, max_length=600)
    severity: Literal['high', 'medium', 'low']


class AnalysisDraft(Contract):
    summary: str = Field(min_length=1, max_length=800)
    requirements: list[Requirement] = Field(min_length=1, max_length=16)
    issues: list[Issue] = Field(max_length=12)


class Question(Contract):
    question: str = Field(min_length=5, max_length=600)
    focus: str = Field(min_length=1, max_length=100)
    category: Literal['基础能力', '项目深挖', '行为面试', '能力补足']


class Scores(Contract):
    relevance: int = Field(ge=0, le=5)
    completeness: int = Field(ge=0, le=5)
    consistency: int = Field(ge=0, le=5)
    clarity: int = Field(ge=0, le=5)
    star: int = Field(ge=0, le=5)
    competency: int = Field(ge=0, le=5)


class Feedback(Contract):
    scores: Scores
    reason: str = Field(min_length=1, max_length=1000)
    strengths: list[str] = Field(min_length=1, max_length=4)
    improvements: list[str] = Field(min_length=1, max_length=4)
    practice: str = Field(min_length=1, max_length=500)
    next_question: Question


class SessionInput(Contract):
    rounds: int = Field(default=5, ge=5, le=12)


class AnswerInput(Contract):
    answer: str = Field(min_length=1, max_length=2200)
    version: int = Field(ge=0)


class StateInput(Contract):
    action: Literal['pause', 'resume']
    version: int = Field(ge=0)
